// SPDX-License-Identifier: GPL-2.0-only
/*
 * FocalTech FT8201P I2C touchscreen driver.
 *
 * The FT8201P application note describes an I2C touch-report interface with
 * a falling-edge TP_INT interrupt.  The controller exposes the standard
 * FocalTech CTPM working-mode report beginning at register 0x01:
 *
 *   0x02: lower nibble is the number of points (0..10)
 *   0x03: ten six-byte point records (X, Y, ID, weight, area)
 *
 * The panel-specific I2C address is intentionally supplied by firmware (or
 * i2c_new_client_device), rather than guessed here.
 */

#include <linux/delay.h>
#include <linux/gpio/consumer.h>
#include <linux/i2c.h>
#include <linux/input.h>
#include <linux/input/mt.h>
#include <linux/input/touchscreen.h>
#include <linux/interrupt.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/pm.h>
#include <linux/slab.h>

#define FT8201P_REG_REPORT		0x01
#define FT8201P_REG_POWER_MODE		0xa5
#define FT8201P_REG_FW_VERSION		0xa6

#define FT8201P_MAX_POINTS		10
#define FT8201P_POINT_SIZE		6
#define FT8201P_STATUS_OFFSET		1
#define FT8201P_FIRST_POINT_OFFSET	2
#define FT8201P_REPORT_SIZE		(FT8201P_FIRST_POINT_OFFSET + \
					 FT8201P_MAX_POINTS * FT8201P_POINT_SIZE)

#define FT8201P_EVENT_DOWN		0
#define FT8201P_EVENT_UP		1
#define FT8201P_EVENT_CONTACT		2
#define FT8201P_EVENT_RESERVED		3

#define FT8201P_POWER_ACTIVE		0x00
#define FT8201P_POWER_SLEEP		0x03

#define FT8201P_DEFAULT_MAX_X		2559
#define FT8201P_DEFAULT_MAX_Y		719

struct ft8201p_ts {
	struct i2c_client *client;
	struct input_dev *input;
	struct touchscreen_properties prop;
	struct gpio_desc *reset_gpio;
};

static int ft8201p_write_reg(struct ft8201p_ts *ts, u8 reg, u8 value)
{
	u8 data[] = { reg, value };
	int ret;

	ret = i2c_master_send(ts->client, data, sizeof(data));
	if (ret == sizeof(data))
		return 0;

	return ret < 0 ? ret : -EIO;
}

static int ft8201p_read_report(struct ft8201p_ts *ts, u8 *report)
{
	u8 reg = FT8201P_REG_REPORT;
	struct i2c_msg msgs[] = {
		{
			.addr = ts->client->addr,
			.len = sizeof(reg),
			.buf = &reg,
		},
		{
			.addr = ts->client->addr,
			.flags = I2C_M_RD,
			.len = FT8201P_REPORT_SIZE,
			.buf = report,
		},
	};
	int ret;

	ret = i2c_transfer(ts->client->adapter, msgs, ARRAY_SIZE(msgs));
	if (ret == ARRAY_SIZE(msgs))
		return 0;

	return ret < 0 ? ret : -EIO;
}

static void ft8201p_reset(struct ft8201p_ts *ts)
{
	/* reset-gpios is logically asserted here, regardless of GPIO polarity. */
	gpiod_set_value_cansleep(ts->reset_gpio, 1);
	msleep(5);
	gpiod_set_value_cansleep(ts->reset_gpio, 0);
	msleep(200);
}

static irqreturn_t ft8201p_irq_thread(int irq, void *data)
{
	struct ft8201p_ts *ts = data;
	struct input_dev *input = ts->input;
	u8 report[FT8201P_REPORT_SIZE];
	u8 points;
	unsigned int active = 0;
	unsigned int i;
	int ret;

	ret = ft8201p_read_report(ts, report);
	if (ret) {
		dev_err_ratelimited(&ts->client->dev,
					"failed to read touch report: %d\n", ret);
		return IRQ_HANDLED;
	}

	points = report[FT8201P_STATUS_OFFSET] & 0x0f;
	if (points > FT8201P_MAX_POINTS) {
		dev_warn_ratelimited(&ts->client->dev,
					 "invalid touch count %u\n", points);
		points = 0;
	}

	for (i = 0; i < points; i++) {
		u8 *point = &report[FT8201P_FIRST_POINT_OFFSET +
				     i * FT8201P_POINT_SIZE];
		u8 event = point[0] >> 6;
		u8 id = point[2] >> 4;
		u16 x = ((point[0] & 0x0f) << 8) | point[1];
		u16 y = ((point[2] & 0x0f) << 8) | point[3];

		if (id >= FT8201P_MAX_POINTS || event == FT8201P_EVENT_RESERVED)
			continue;

		input_mt_slot(input, id);
		if (event == FT8201P_EVENT_UP) {
			input_mt_report_slot_state(input, MT_TOOL_FINGER, false);
			continue;
		}

		input_mt_report_slot_state(input, MT_TOOL_FINGER, true);
		touchscreen_report_pos(input, &ts->prop, x, y, true);
		input_report_abs(input, ABS_MT_PRESSURE, point[4]);
		input_report_abs(input, ABS_MT_TOUCH_MAJOR, point[5] >> 4);
		active++;
	}

	input_mt_sync_frame(input);
	input_report_key(input, BTN_TOUCH, active > 0);
	input_sync(input);

	return IRQ_HANDLED;
}

static int ft8201p_suspend(struct device *dev)
{
	struct ft8201p_ts *ts = dev_get_drvdata(dev);
	int ret;

	disable_irq(ts->client->irq);
	ret = ft8201p_write_reg(ts, FT8201P_REG_POWER_MODE, FT8201P_POWER_SLEEP);
	if (ret)
		enable_irq(ts->client->irq);

	return ret;
}

static int ft8201p_resume(struct device *dev)
{
	struct ft8201p_ts *ts = dev_get_drvdata(dev);

	/* The application note requires TP_EXT_RSTN to leave sleep mode. */
	ft8201p_reset(ts);
	enable_irq(ts->client->irq);

	return 0;
}

static DEFINE_SIMPLE_DEV_PM_OPS(ft8201p_pm_ops, ft8201p_suspend,
				 ft8201p_resume);

static int ft8201p_probe(struct i2c_client *client)
{
	struct device *dev = &client->dev;
	struct ft8201p_ts *ts;
	struct input_dev *input;
	int fw_version;
	int ret;

	if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))
		return dev_err_probe(dev, -EOPNOTSUPP,
				     "adapter lacks plain I2C transfers\n");

	ts = devm_kzalloc(dev, sizeof(*ts), GFP_KERNEL);
	if (!ts)
		return -ENOMEM;

	input = devm_input_allocate_device(dev);
	if (!input)
		return -ENOMEM;

	ts->client = client;
	ts->input = input;
	i2c_set_clientdata(client, ts);

	/* TP_EXT_RSTN is required because only reset can leave sleep mode. */
	ts->reset_gpio = devm_gpiod_get(dev, "reset", GPIOD_OUT_LOW);
	if (IS_ERR(ts->reset_gpio))
		return dev_err_probe(dev, PTR_ERR(ts->reset_gpio),
				     "reset-gpios is required\n");

	if (client->irq <= 0)
		return dev_err_probe(dev, -EINVAL,
				     "a falling-edge TP_INT interrupt is required\n");

	input->name = "FocalTech FT8201P Touchscreen";
	input->id.bustype = BUS_I2C;
	input->dev.parent = dev;

	input_set_abs_params(input, ABS_MT_POSITION_X, 0,
			     FT8201P_DEFAULT_MAX_X, 0, 0);
	input_set_abs_params(input, ABS_MT_POSITION_Y, 0,
			     FT8201P_DEFAULT_MAX_Y, 0, 0);
	input_set_abs_params(input, ABS_MT_PRESSURE, 0, 255, 0, 0);
	input_set_abs_params(input, ABS_MT_TOUCH_MAJOR, 0, 15, 0, 0);
	touchscreen_parse_properties(input, true, &ts->prop);

	ret = input_mt_init_slots(input, FT8201P_MAX_POINTS,
				  INPUT_MT_DIRECT | INPUT_MT_DROP_UNUSED);
	if (ret)
		return ret;

	input_set_capability(input, EV_KEY, BTN_TOUCH);

	ft8201p_reset(ts);
	fw_version = i2c_smbus_read_byte_data(client, FT8201P_REG_FW_VERSION);
	if (fw_version < 0)
		dev_warn(dev, "could not read firmware version: %d\n", fw_version);
	else
		dev_info(dev, "firmware version 0x%02x\n", fw_version);

	ret = input_register_device(input);
	if (ret)
		return ret;

	ret = devm_request_threaded_irq(dev, client->irq, NULL,
					ft8201p_irq_thread,
					IRQF_ONESHOT | IRQF_TRIGGER_FALLING,
					dev_name(dev), ts);
	if (ret)
		return dev_err_probe(dev, ret, "failed to request TP_INT IRQ\n");

	return 0;
}

static const struct of_device_id ft8201p_of_match[] = {
	{ .compatible = "focaltech,ft8201p" },
	{ }
};
MODULE_DEVICE_TABLE(of, ft8201p_of_match);

static const struct i2c_device_id ft8201p_id[] = {
	{ "ft8201p", 0 },
	{ }
};
MODULE_DEVICE_TABLE(i2c, ft8201p_id);

static struct i2c_driver ft8201p_driver = {
	.driver = {
		.name = "ft8201p",
		.of_match_table = ft8201p_of_match,
		.pm = pm_sleep_ptr(&ft8201p_pm_ops),
	},
	.probe = ft8201p_probe,
	.id_table = ft8201p_id,
};
module_i2c_driver(ft8201p_driver);

MODULE_AUTHOR("Tikpal");
MODULE_DESCRIPTION("FocalTech FT8201P I2C touchscreen driver");
MODULE_LICENSE("GPL");

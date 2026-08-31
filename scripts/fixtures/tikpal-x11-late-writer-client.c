#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <xcb/xcb.h>

static volatile sig_atomic_t running = 1;

static void stop_running(int signal_number) {
  (void)signal_number;
  running = 0;
}

static xcb_screen_t *screen_for_number(xcb_connection_t *connection, int screen_number) {
  const xcb_setup_t *setup = xcb_get_setup(connection);
  xcb_screen_iterator_t iterator = xcb_setup_roots_iterator(setup);
  while (iterator.rem && screen_number > 0) {
    xcb_screen_next(&iterator);
    screen_number--;
  }
  return iterator.rem ? iterator.data : NULL;
}

static xcb_connection_t *connect_display(const char *display, xcb_screen_t **screen) {
  int screen_number = 0;
  xcb_connection_t *connection = xcb_connect(display && display[0] ? display : NULL, &screen_number);
  if (!connection || xcb_connection_has_error(connection) != 0) {
    if (connection) xcb_disconnect(connection);
    return NULL;
  }
  *screen = screen_for_number(connection, screen_number);
  if (!*screen) {
    xcb_disconnect(connection);
    return NULL;
  }
  return connection;
}

static xcb_atom_t intern_atom(xcb_connection_t *connection, const char *name) {
  xcb_intern_atom_cookie_t cookie = xcb_intern_atom(connection, 0, strlen(name), name);
  xcb_intern_atom_reply_t *reply = xcb_intern_atom_reply(connection, cookie, NULL);
  xcb_atom_t atom = reply ? reply->atom : XCB_ATOM_NONE;
  free(reply);
  return atom;
}

static int fence_connection(xcb_connection_t *connection) {
  xcb_get_input_focus_cookie_t cookie = xcb_get_input_focus(connection);
  xcb_generic_error_t *error = NULL;
  xcb_get_input_focus_reply_t *reply = xcb_get_input_focus_reply(connection, cookie, &error);
  int status = reply && !error ? 0 : 1;
  free(reply);
  free(error);
  return status;
}

static bool parse_u32(const char *value, uint32_t *output) {
  char *end = NULL;
  errno = 0;
  unsigned long parsed = strtoul(value, &end, 10);
  if (errno != 0 || !end || *end || parsed == 0 || parsed > UINT32_MAX) return false;
  *output = (uint32_t)parsed;
  return true;
}

static bool parse_i32(const char *value, int32_t *output) {
  char *end = NULL;
  errno = 0;
  long parsed = strtol(value, &end, 10);
  if (errno != 0 || !end || *end || parsed < INT32_MIN || parsed > INT32_MAX) return false;
  *output = (int32_t)parsed;
  return true;
}

static int write_xid(const char *path, xcb_window_t window) {
  FILE *output = fopen(path, "w");
  if (!output) return 1;
  int status = fprintf(output, "%u\n", window) > 0 ? 0 : 1;
  if (fclose(output) != 0) status = 1;
  return status;
}

static int run_surface(int argc, char **argv) {
  const char *display = NULL;
  const char *output_path = NULL;
  const char *profile = NULL;
  int16_t x = 0;
  int16_t y = 0;
  uint16_t width = 1920;
  uint16_t height = 720;
  for (int index = 2; index < argc; index++) {
    if (strcmp(argv[index], "--display") == 0 && index + 1 < argc) display = argv[++index];
    else if (strcmp(argv[index], "--output") == 0 && index + 1 < argc) output_path = argv[++index];
    else if (strncmp(argv[index], "--user-data-dir=", 16) == 0) profile = argv[index] + 16;
    else if (strcmp(argv[index], "--x") == 0 && index + 1 < argc) x = (int16_t)strtol(argv[++index], NULL, 10);
    else if (strcmp(argv[index], "--y") == 0 && index + 1 < argc) y = (int16_t)strtol(argv[++index], NULL, 10);
    else if (strcmp(argv[index], "--width") == 0 && index + 1 < argc) width = (uint16_t)strtoul(argv[++index], NULL, 10);
    else if (strcmp(argv[index], "--height") == 0 && index + 1 < argc) height = (uint16_t)strtoul(argv[++index], NULL, 10);
    else return 64;
  }
  if (!display || !output_path || !profile || !profile[0] || width == 0 || height == 0) return 64;

  xcb_screen_t *screen = NULL;
  xcb_connection_t *connection = connect_display(display, &screen);
  if (!connection) return 1;
  xcb_atom_t pid_atom = intern_atom(connection, "_NET_WM_PID");
  xcb_atom_t opacity_atom = intern_atom(connection, "_NET_WM_WINDOW_OPACITY");
  if (pid_atom == XCB_ATOM_NONE || opacity_atom == XCB_ATOM_NONE) {
    xcb_disconnect(connection);
    return 1;
  }

  xcb_window_t window = xcb_generate_id(connection);
  uint32_t values[] = {screen->black_pixel};
  xcb_create_window(connection, XCB_COPY_FROM_PARENT, window, screen->root,
                    x, y, width, height, 0, XCB_WINDOW_CLASS_INPUT_OUTPUT,
                    screen->root_visual, XCB_CW_BACK_PIXEL, values);
  uint32_t pid = (uint32_t)getpid();
  uint32_t opacity = UINT32_MAX;
  const char wm_class[] = "fixture\0Chromium\0";
  xcb_change_property(connection, XCB_PROP_MODE_REPLACE, window, pid_atom,
                      XCB_ATOM_CARDINAL, 32, 1, &pid);
  xcb_change_property(connection, XCB_PROP_MODE_REPLACE, window, XCB_ATOM_WM_CLASS,
                      XCB_ATOM_STRING, 8, sizeof(wm_class), wm_class);
  xcb_change_property(connection, XCB_PROP_MODE_REPLACE, window, opacity_atom,
                      XCB_ATOM_CARDINAL, 32, 1, &opacity);
  xcb_map_window(connection, window);
  if (xcb_flush(connection) <= 0 || fence_connection(connection) != 0 ||
      write_xid(output_path, window) != 0) {
    xcb_disconnect(connection);
    return 1;
  }

  signal(SIGTERM, stop_running);
  signal(SIGINT, stop_running);
  while (running) pause();
  xcb_destroy_window(connection, window);
  xcb_flush(connection);
  xcb_disconnect(connection);
  return 0;
}

static int configure_window(xcb_connection_t *connection, xcb_window_t window,
                            int32_t x, int32_t y, uint32_t width, uint32_t height) {
  uint32_t values[] = {(uint32_t)x, (uint32_t)y, width, height};
  xcb_void_cookie_t cookie = xcb_configure_window_checked(
    connection, window,
    XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y |
      XCB_CONFIG_WINDOW_WIDTH | XCB_CONFIG_WINDOW_HEIGHT,
    values);
  xcb_generic_error_t *error = xcb_request_check(connection, cookie);
  if (!error) return 0;
  free(error);
  return 1;
}

static int run_mutate(int argc, char **argv) {
  const char *display = NULL;
  const char *mode = NULL;
  uint32_t target = 0;
  uint32_t previous = 0;
  for (int index = 2; index < argc; index++) {
    if (strcmp(argv[index], "--display") == 0 && index + 1 < argc) display = argv[++index];
    else if (strcmp(argv[index], "--mode") == 0 && index + 1 < argc) mode = argv[++index];
    else if (strcmp(argv[index], "--target") == 0 && index + 1 < argc && parse_u32(argv[index + 1], &target)) index++;
    else if (strcmp(argv[index], "--previous") == 0 && index + 1 < argc && parse_u32(argv[index + 1], &previous)) index++;
    else return 64;
  }
  if (!display || !mode || target == 0 || previous == 0) return 64;
  xcb_screen_t *screen = NULL;
  xcb_connection_t *connection = connect_display(display, &screen);
  (void)screen;
  if (!connection) return 1;
  int status = 0;
  if (strcmp(mode, "reverse") == 0) {
    status |= configure_window(connection, target, 2560, 0, 1920, 720);
    status |= configure_window(connection, previous, 0, 0, 1920, 720);
  } else if (strcmp(mode, "correct") == 0) {
    status |= configure_window(connection, previous, 2560, 0, 1920, 720);
    status |= configure_window(connection, target, 0, 0, 1920, 720);
  } else {
    xcb_disconnect(connection);
    return 64;
  }
  if (xcb_flush(connection) <= 0 || fence_connection(connection) != 0) status = 1;
  xcb_disconnect(connection);
  return status;
}

static int run_geometry(int argc, char **argv) {
  if (argc != 3) return 64;
  uint32_t window = 0;
  if (!parse_u32(argv[2], &window)) return 64;
  xcb_screen_t *screen = NULL;
  xcb_connection_t *connection = connect_display(getenv("DISPLAY"), &screen);
  if (!connection) return 1;
  xcb_get_geometry_cookie_t geometry_cookie = xcb_get_geometry(connection, window);
  xcb_translate_coordinates_cookie_t translate_cookie =
    xcb_translate_coordinates(connection, window, screen->root, 0, 0);
  xcb_generic_error_t *geometry_error = NULL;
  xcb_generic_error_t *translate_error = NULL;
  xcb_get_geometry_reply_t *geometry =
    xcb_get_geometry_reply(connection, geometry_cookie, &geometry_error);
  xcb_translate_coordinates_reply_t *translate =
    xcb_translate_coordinates_reply(connection, translate_cookie, &translate_error);
  int status = 1;
  if (geometry && translate && !geometry_error && !translate_error) {
    printf("%d,%d_%ux%u\n", translate->dst_x, translate->dst_y,
           geometry->width, geometry->height);
    status = 0;
  }
  free(geometry);
  free(translate);
  free(geometry_error);
  free(translate_error);
  xcb_disconnect(connection);
  return status;
}

static int run_map_state(int argc, char **argv) {
  if (argc != 3) return 64;
  uint32_t window = 0;
  if (!parse_u32(argv[2], &window)) return 64;
  xcb_screen_t *screen = NULL;
  xcb_connection_t *connection = connect_display(getenv("DISPLAY"), &screen);
  (void)screen;
  if (!connection) return 1;
  xcb_generic_error_t *error = NULL;
  xcb_get_window_attributes_reply_t *attributes =
    xcb_get_window_attributes_reply(connection, xcb_get_window_attributes(connection, window), &error);
  int status = 1;
  if (attributes && !error) {
    switch (attributes->map_state) {
      case XCB_MAP_STATE_VIEWABLE: puts("viewable"); break;
      case XCB_MAP_STATE_UNVIEWABLE: puts("unviewable"); break;
      default: puts("unmapped"); break;
    }
    status = 0;
  }
  free(attributes);
  free(error);
  xcb_disconnect(connection);
  return status;
}

static int run_cardinal_property(int argc, char **argv, const char *atom_name,
                                 const char *missing_value) {
  if (argc != 3) return 64;
  uint32_t window = 0;
  if (!parse_u32(argv[2], &window)) return 64;
  xcb_screen_t *screen = NULL;
  xcb_connection_t *connection = connect_display(getenv("DISPLAY"), &screen);
  (void)screen;
  if (!connection) return 1;
  xcb_atom_t atom = intern_atom(connection, atom_name);
  if (atom == XCB_ATOM_NONE) {
    xcb_disconnect(connection);
    return 1;
  }
  xcb_generic_error_t *error = NULL;
  xcb_get_property_reply_t *property = xcb_get_property_reply(
    connection,
    xcb_get_property(connection, 0, window, atom, XCB_ATOM_CARDINAL, 0, 1),
    &error);
  int status = 1;
  if (property && !error) {
    if (xcb_get_property_value_length(property) >= (int)sizeof(uint32_t)) {
      const uint32_t *value = xcb_get_property_value(property);
      printf("%u\n", *value);
    } else {
      puts(missing_value);
    }
    status = 0;
  }
  free(property);
  free(error);
  xcb_disconnect(connection);
  return status;
}

static int run_window(int argc, char **argv) {
  const char *display = NULL;
  const char *action = NULL;
  uint32_t window = 0;
  int32_t x = 0;
  int32_t y = 0;
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t opacity = UINT32_MAX;
  for (int index = 2; index < argc; index++) {
    if (strcmp(argv[index], "--display") == 0 && index + 1 < argc) display = argv[++index];
    else if (strcmp(argv[index], "--action") == 0 && index + 1 < argc) action = argv[++index];
    else if (strcmp(argv[index], "--xid") == 0 && index + 1 < argc &&
             parse_u32(argv[index + 1], &window)) index++;
    else if (strcmp(argv[index], "--x") == 0 && index + 1 < argc &&
             parse_i32(argv[index + 1], &x)) index++;
    else if (strcmp(argv[index], "--y") == 0 && index + 1 < argc &&
             parse_i32(argv[index + 1], &y)) index++;
    else if (strcmp(argv[index], "--width") == 0 && index + 1 < argc &&
             parse_u32(argv[index + 1], &width)) index++;
    else if (strcmp(argv[index], "--height") == 0 && index + 1 < argc &&
             parse_u32(argv[index + 1], &height)) index++;
    else if (strcmp(argv[index], "--opacity") == 0 && index + 1 < argc) {
      char *end = NULL;
      errno = 0;
      unsigned long long parsed = strtoull(argv[++index], &end, 0);
      if (errno != 0 || !end || *end || parsed > UINT32_MAX) return 64;
      opacity = (uint32_t)parsed;
    } else return 64;
  }
  if (!display || !action || window == 0) return 64;

  xcb_screen_t *screen = NULL;
  xcb_connection_t *connection = connect_display(display, &screen);
  (void)screen;
  if (!connection) return 1;
  xcb_void_cookie_t cookie;
  if (strcmp(action, "raise") == 0 || strcmp(action, "lower") == 0) {
    uint32_t mode = strcmp(action, "raise") == 0 ? XCB_STACK_MODE_ABOVE : XCB_STACK_MODE_BELOW;
    cookie = xcb_configure_window_checked(connection, window,
                                          XCB_CONFIG_WINDOW_STACK_MODE, &mode);
  } else if (strcmp(action, "map") == 0) {
    cookie = xcb_map_window_checked(connection, window);
  } else if (strcmp(action, "unmap") == 0) {
    cookie = xcb_unmap_window_checked(connection, window);
  } else if (strcmp(action, "geometry") == 0 && width > 0 && height > 0) {
    int status = configure_window(connection, window, x, y, width, height);
    if (xcb_flush(connection) <= 0 || fence_connection(connection) != 0) status = 1;
    xcb_disconnect(connection);
    return status;
  } else if (strcmp(action, "opacity") == 0) {
    xcb_atom_t opacity_atom = intern_atom(connection, "_NET_WM_WINDOW_OPACITY");
    if (opacity_atom == XCB_ATOM_NONE) {
      xcb_disconnect(connection);
      return 1;
    }
    cookie = xcb_change_property_checked(connection, XCB_PROP_MODE_REPLACE, window,
                                         opacity_atom, XCB_ATOM_CARDINAL, 32, 1, &opacity);
  } else {
    xcb_disconnect(connection);
    return 64;
  }
  xcb_generic_error_t *error = xcb_request_check(connection, cookie);
  int status = error ? 1 : 0;
  free(error);
  if (xcb_flush(connection) <= 0 || fence_connection(connection) != 0) status = 1;
  xcb_disconnect(connection);
  return status;
}

static int run_stack(int argc, char **argv) {
  if (argc != 5) return 64;
  uint32_t provider = 0;
  uint32_t panel = 0;
  uint32_t kiosk = 0;
  if (!parse_u32(argv[2], &provider) || !parse_u32(argv[3], &panel) ||
      !parse_u32(argv[4], &kiosk)) return 64;
  xcb_screen_t *screen = NULL;
  xcb_connection_t *connection = connect_display(getenv("DISPLAY"), &screen);
  if (!connection) return 1;
  xcb_generic_error_t *error = NULL;
  xcb_query_tree_reply_t *tree = xcb_query_tree_reply(
    connection, xcb_query_tree(connection, screen->root), &error);
  if (!tree || error) {
    free(tree);
    free(error);
    xcb_disconnect(connection);
    return 1;
  }
  int child_count = xcb_query_tree_children_length(tree);
  xcb_window_t *children = xcb_query_tree_children(tree);
  int provider_rank = 0;
  int panel_rank = 0;
  int kiosk_rank = 0;
  for (int index = 0; index < child_count; index++) {
    int top_first_rank = child_count - index;
    if (children[index] == provider) provider_rank = top_first_rank;
    if (children[index] == panel) panel_rank = top_first_rank;
    if (children[index] == kiosk) kiosk_rank = top_first_rank;
  }
  free(tree);
  free(error);
  xcb_disconnect(connection);
  if (provider_rank == 0 || panel_rank == 0 || kiosk_rank == 0) return 1;
  printf("%d\t%d\t%d\n", provider_rank, panel_rank, kiosk_rank);
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2) return 64;
  if (strcmp(argv[1], "surface") == 0) return run_surface(argc, argv);
  if (strcmp(argv[1], "mutate") == 0) return run_mutate(argc, argv);
  if (strcmp(argv[1], "geometry") == 0) return run_geometry(argc, argv);
  if (strcmp(argv[1], "map-state") == 0) return run_map_state(argc, argv);
  if (strcmp(argv[1], "opacity") == 0)
    return run_cardinal_property(argc, argv, "_NET_WM_WINDOW_OPACITY", "unset");
  if (strcmp(argv[1], "pid") == 0)
    return run_cardinal_property(argc, argv, "_NET_WM_PID", "missing");
  if (strcmp(argv[1], "window") == 0) return run_window(argc, argv);
  if (strcmp(argv[1], "stack") == 0) return run_stack(argc, argv);
  return 64;
}

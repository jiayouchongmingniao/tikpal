/* Debian xdotool lacks windowlower. KWin also needs a tool-origin restack
 * request for managed windows. Keep this adapter private to Tikpal's PATH. */
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <xcb/xcb.h>

int main(int argc, char **argv) {
  if (argc < 2 || (strcmp(argv[1], "windowlower") != 0 && strcmp(argv[1], "windowraise") != 0)) {
    execv("/usr/bin/xdotool", argv);
    perror("/usr/bin/xdotool");
    return 127;
  }
  if (argc != 3) return 64;
  char *end = NULL;
  errno = 0;
  unsigned long xid = strtoul(argv[2], &end, 0);
  if (errno || !end || *end || xid == 0 || xid > UINT32_MAX) return 64;
  xcb_connection_t *connection = xcb_connect(NULL, NULL);
  if (xcb_connection_has_error(connection)) {
    xcb_disconnect(connection);
    return 1;
  }
  xcb_get_geometry_reply_t *geometry = xcb_get_geometry_reply(connection,
    xcb_get_geometry(connection, (xcb_drawable_t)xid), NULL);
  if (!geometry) { xcb_disconnect(connection); return 1; }
  free(geometry);
  uint32_t mode = strcmp(argv[1], "windowlower") == 0 ? XCB_STACK_MODE_BELOW : XCB_STACK_MODE_ABOVE;
  xcb_screen_t *screen = xcb_setup_roots_iterator(xcb_get_setup(connection)).data;
  const char *name = "_NET_RESTACK_WINDOW";
  xcb_intern_atom_reply_t *atom = xcb_intern_atom_reply(connection,
    xcb_intern_atom(connection, 1, strlen(name), name), NULL);
  xcb_void_cookie_t cookie;
  if (atom && atom->atom != XCB_ATOM_NONE) {
    xcb_client_message_event_t event = {0};
    event.response_type = XCB_CLIENT_MESSAGE;
    event.format = 32;
    event.window = (xcb_window_t)xid;
    event.type = atom->atom;
    event.data.data32[0] = 2; /* EWMH source: pager/tool */
    event.data.data32[2] = mode;
    cookie = xcb_send_event_checked(connection, 0, screen->root,
      XCB_EVENT_MASK_SUBSTRUCTURE_REDIRECT | XCB_EVENT_MASK_SUBSTRUCTURE_NOTIFY,
      (const char *)&event);
  } else {
    cookie = xcb_configure_window_checked(connection, (xcb_window_t)xid,
      XCB_CONFIG_WINDOW_STACK_MODE, &mode);
  }
  free(atom);
  xcb_generic_error_t *error = xcb_request_check(connection, cookie);
  int status = error != NULL || xcb_connection_has_error(connection);
  if (error) fprintf(stderr, "windowlower: X11 error %u\n", error->error_code);
  free(error);
  xcb_disconnect(connection);
  return status;
}

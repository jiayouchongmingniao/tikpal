#define _GNU_SOURCE
#ifdef __APPLE__
#define _DARWIN_C_SOURCE
#endif

#include <arpa/inet.h>
#include <errno.h>
#include <ctype.h>
#include <dirent.h>
#include <fcntl.h>
#include <inttypes.h>
#include <json-c/json.h>
#include <limits.h>
#include <poll.h>
#include <pwd.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <xcb/xcb.h>
#include <xcb/xcbext.h>

#ifndef SOCK_CLOEXEC
#define SOCK_CLOEXEC 0
#endif

#define DEFAULT_SOCKET_PATH "/run/tikpal/x11-helper.sock"
#define DEFAULT_GENERATION_PATH "/home/moode/.config/tikpal-web-mode/x11-helper-generation"
#define DEFAULT_TRANSACTION_TIMEOUT_MS 250
#define DEFAULT_CONNECT_TIMEOUT_MS 50
#define DEFAULT_RESPONSE_TIMEOUT_MS 300
#define DEFAULT_WATCH_LEASE_DURATION_MS 5000
#define MAX_WATCH_LEASE_DURATION_MS 5000
#define MIN_INSPECT_TRANSACTION_TIMEOUT_MS 500
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
#define SELF_TEST_TRANSACTION_TIMEOUT_MS 1000
#define SELF_TEST_LEASE_DURATION_MS 1250
#define MAX_LEASE_DURATION_MS 1250
#else
#define SELF_TEST_TRANSACTION_TIMEOUT_MS DEFAULT_TRANSACTION_TIMEOUT_MS
#define SELF_TEST_LEASE_DURATION_MS 350
#define MAX_LEASE_DURATION_MS 350
#endif
#define MAX_PACKET_BYTES 16384
#define MAX_SURFACES 8
#define MAX_PENDING (MAX_SURFACES * 7)
#define MAX_MUTATIONS 8
#define MAX_REQUEST_ID 128
#define MAX_ROLE 32
#define MAX_CALLER_ROLE 64
#define MAX_CLASS 256
#define MAX_WATCH_INVALID_REASON 64
#define MAX_WATCH_EVENT_HISTORY 64
#define REQUEST_CACHE_SIZE 32
/* Every supported local client writes its framed request immediately after
 * connect.  Keep an incomplete peer from monopolising the single-threaded
 * daemon long enough to delay a foreground switch behind several 300 ms reads. */
#define SERVER_FRAME_TIMEOUT_MS 50
#define SURFACE_QUERY_FAILED -3
#define SURFACE_QUERY_DEADLINE_EXCEEDED -6

_Static_assert(sizeof(((xcb_get_geometry_cookie_t *)0)->sequence) == sizeof(uint32_t),
               "generated XCB cookies must expose a 32-bit sequence");

typedef enum {
  GENERATION_OK,
  GENERATION_MISSING,
  GENERATION_MALFORMED,
  GENERATION_IO_ERROR,
} GenerationState;

typedef enum {
  WATCH_REPAIR_OBSERVE,
  WATCH_REPAIR_PANEL,
  WATCH_REPAIR_PROVIDER,
} WatchRepairScope;

typedef enum {
  PENDING_GEOMETRY,
  PENDING_TRANSLATE,
  PENDING_ATTRIBUTES,
  PENDING_PID,
  PENDING_CLASS,
  PENDING_OPACITY,
  PENDING_TREE,
} PendingKind;

typedef struct {
  uint32_t sequence;
  PendingKind kind;
  size_t surface_index;
  void *reply;
  xcb_generic_error_t *error;
  bool done;
} PendingReply;

typedef enum {
  COLLECT_OK = 0,
  COLLECT_REPLY_TIMEOUT = -1,
  COLLECT_XCB_CONNECTION_ERROR = -2,
  COLLECT_POLL_ERROR = -4,
  COLLECT_INTERRUPTED = -5,
} CollectResult;

typedef struct {
  uint32_t sequence;
  PendingKind kind;
  size_t surface_index;
  bool done;
  bool reply_ready;
  bool error_ready;
} PendingDiagnostic;

typedef struct {
  CollectResult result;
  int connection_error;
  int poll_errno;
  short poll_revents;
  size_t pending_count;
  size_t completed_count;
  size_t pending_diagnostic_count;
  bool final_scan;
  bool final_scan_progressed;
  bool stop_requested;
  PendingDiagnostic pending[MAX_PENDING];
} CollectorDiagnostics;

typedef struct {
  char role[MAX_ROLE];
  xcb_window_t xid;
  char profile[PATH_MAX];
  int32_t target_x;
  int32_t target_y;
  uint32_t target_width;
  uint32_t target_height;
  bool has_target_geometry;
  bool has_target_opacity;
  uint32_t target_opacity;
} SurfaceRequest;

typedef struct {
  SurfaceRequest request;
  xcb_get_geometry_reply_t *geometry;
  xcb_translate_coordinates_reply_t *translate;
  xcb_get_window_attributes_reply_t *attributes;
  xcb_get_property_reply_t *pid_property;
  xcb_get_property_reply_t *class_property;
  xcb_get_property_reply_t *opacity_property;
  xcb_query_tree_reply_t *tree;
  xcb_generic_error_t *first_error;
  uint32_t pid;
  uid_t uid;
  unsigned long long pid_starttime;
  char class_instance[MAX_CLASS];
  char class_name[MAX_CLASS];
  bool profile_matched;
  bool class_matched;
  bool geometry_usable;
  bool map_viewable;
  bool opacity_present;
  bool opacity_full;
  uint32_t opacity;
  bool ok;
  const char *code;
} SurfaceResult;

typedef struct {
  uint32_t pid;
  uid_t uid;
  unsigned long long starttime;
} SurfaceIdentity;

typedef struct {
  uint32_t sequence;
  char action[40];
  xcb_window_t xid;
  xcb_generic_error_t *error;
  bool done;
} CheckedMutation;

typedef struct {
  bool used;
  char request_id[MAX_REQUEST_ID + 1];
  size_t request_length;
  char request[MAX_PACKET_BYTES + 1];
  size_t response_length;
  char response[MAX_PACKET_BYTES + 1];
} CachedRequest;

typedef struct {
  uint16_t sequence;
  uint8_t response_type;
  xcb_window_t xid;
  xcb_atom_t property;
  bool root_forwarded;
  bool would_repair;
  char role[MAX_ROLE];
  char type[24];
} WatchEvent;

typedef struct {
  xcb_connection_t *connection;
  xcb_screen_t *screen;
  xcb_atom_t net_wm_pid;
  xcb_atom_t net_wm_opacity;
  uint64_t connection_epoch;
  char daemon_instance_id[80];
  char display[128];
  char generation_path[PATH_MAX];
  uint64_t generation_floor;
  GenerationState generation_state;
  /* Phase 3A is observation-only.  This state is deliberately separate from
   * the short switch lease so enabling a watch never changes switch ownership. */
  bool watch_valid;
  char watch_invalid_reason[MAX_WATCH_INVALID_REASON];
  char watch_lease_id[80];
  uint64_t watch_generation;
  uint64_t watch_epoch;
  int64_t watch_expires_ns;
  xcb_window_t watch_surfaces[MAX_SURFACES];
  char watch_roles[MAX_SURFACES][MAX_ROLE];
  SurfaceRequest watch_targets[MAX_SURFACES];
  size_t watch_surface_count;
  WatchRepairScope watch_repair_scope;
  bool watch_repair_pending;
  bool watch_repair_in_flight;
  uint64_t watch_events_received;
  uint64_t watch_events_reported;
  uint64_t watch_events_would_repair;
  uint64_t watch_events_stale_dropped;
  uint64_t watch_events_unrelated_dropped;
  uint64_t watch_events_duplicate_dropped;
  uint64_t watch_repair_requests;
  uint64_t watch_repair_mutations;
  uint64_t watch_repair_failures;
  WatchEvent watch_event_history[MAX_WATCH_EVENT_HISTORY];
  size_t watch_event_history_count;
  size_t next_watch_event_slot;
  uint64_t watch_requests;
  uint64_t watch_renew_requests;
  uint64_t watch_unwatch_requests;
  bool in_flight;
  bool mutation_started;
  bool lease_active;
  char lease_id[80];
  uint64_t lease_generation;
  uint64_t lease_epoch;
  int64_t lease_expires_ns;
  xcb_window_t lease_surfaces[MAX_SURFACES];
  size_t lease_surface_count;
  uint64_t total_requests;
  uint64_t inspect_requests;
  uint64_t inspect_failures;
  uint64_t guard_paused_requests;
  uint64_t protocol_frame_timeouts;
  uint64_t switch_requests;
  uint64_t switch_failures;
  uint64_t mutation_requests;
  uint64_t revoke_requests;
  uint64_t xcb_timeouts;
  uint64_t reconnects;
  CollectorDiagnostics last_collect;
  CachedRequest request_cache[REQUEST_CACHE_SIZE];
  size_t next_cache_slot;
  int phase;
  int transaction_timeout_ms;
} HelperState;

typedef enum {
  FRAME_OK,
  FRAME_EOF,
  FRAME_PARTIAL_HEADER,
  FRAME_INVALID_LENGTH,
  FRAME_PARTIAL_PAYLOAD,
  FRAME_IO_ERROR,
  FRAME_TIMEOUT,
} FrameResult;

typedef struct {
  bool seen;
  uint8_t error_code;
  uint8_t major_code;
  uint16_t minor_code;
  uint32_t resource_id;
  uint16_t sequence;
} AsyncError;

static volatile sig_atomic_t stop_requested = 0;

#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
typedef enum {
  SELF_TEST_IDENTITY_NORMAL,
  SELF_TEST_IDENTITY_UNAVAILABLE,
  SELF_TEST_IDENTITY_UID_MISMATCH,
  SELF_TEST_IDENTITY_STARTTIME_CHANGE,
} SelfTestIdentityMode;

static uint32_t self_test_identity_pid = 0;
static const char *self_test_identity_profile = NULL;
static uint32_t self_test_identity_fault_pid = 0;
static SelfTestIdentityMode self_test_identity_mode = SELF_TEST_IDENTITY_NORMAL;
static unsigned self_test_identity_read_count = 0;
static void (*self_test_before_mutation_hook)(void) = NULL;
static void (*self_test_before_final_query_hook)(void) = NULL;
static xcb_window_t self_test_bad_match_sibling = XCB_WINDOW_NONE;
static bool self_test_checked_not_ready = false;
static bool self_test_defer_reply_scan_once = false;
static bool self_test_force_poll_timeout_once = false;
#endif

#ifndef __linux__
static int set_cloexec(int descriptor) {
  int flags = fcntl(descriptor, F_GETFD, 0);
  return flags < 0 || fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC) != 0 ? -1 : 0;
}
#endif

static int accept_cloexec(int listener) {
#ifdef __linux__
  return accept4(listener, NULL, NULL, SOCK_CLOEXEC);
#else
  int descriptor = accept(listener, NULL, NULL);
  if (descriptor >= 0 && set_cloexec(descriptor) != 0) {
    close(descriptor);
    return -1;
  }
  return descriptor;
#endif
}

static void handle_signal(int signal_number) {
  (void)signal_number;
  stop_requested = 1;
}

static int64_t monotonic_ns(void) {
  struct timespec timestamp;
  if (clock_gettime(CLOCK_MONOTONIC, &timestamp) != 0) return -1;
  return (int64_t)timestamp.tv_sec * 1000000000LL + timestamp.tv_nsec;
}

static int64_t monotonic_ms(void) {
  int64_t value = monotonic_ns();
  return value < 0 ? -1 : value / 1000000LL;
}

static json_object *duration_ms_json(int64_t started_ns, int64_t completed_ns) {
  if (started_ns < 0 || completed_ns < started_ns) return json_object_new_double(-1.0);
  return json_object_new_double((double)(completed_ns - started_ns) / 1000000.0);
}

static void add_client_metadata(json_object *request) {
  const char *caller_role = getenv("TIKPAL_X11_HELPER_CALLER_ROLE");
  if (!caller_role || !caller_role[0] || strlen(caller_role) > MAX_CALLER_ROLE) {
    caller_role = "client";
  }
  json_object_object_add(request, "callerPid", json_object_new_int64((int64_t)getppid()));
  json_object_object_add(request, "callerRole", json_object_new_string(caller_role));
}

static int remaining_timeout_ms(int64_t deadline_ns) {
  int64_t now = monotonic_ns();
  int64_t remaining;
  if (now < 0 || deadline_ns <= now) return 0;
  remaining = deadline_ns - now;
  remaining = (remaining + 999999LL) / 1000000LL;
  return remaining > INT_MAX ? INT_MAX : (int)remaining;
}

static int64_t inspect_deadline_ns(const HelperState *state, int64_t received_ns) {
  int timeout_ms = state->transaction_timeout_ms;
  if (timeout_ms < MIN_INSPECT_TRANSACTION_TIMEOUT_MS) {
    timeout_ms = MIN_INSPECT_TRANSACTION_TIMEOUT_MS;
  }
  return received_ns + (int64_t)timeout_ms * 1000000LL;
}

static const char *generation_state_name(GenerationState state) {
  switch (state) {
    case GENERATION_OK: return "ok";
    case GENERATION_MISSING: return "missing";
    case GENERATION_MALFORMED: return "malformed";
    case GENERATION_IO_ERROR: return "io_error";
  }
  return "unknown";
}

static void load_generation_floor(HelperState *state) {
  char buffer[128];
  char *end = NULL;
  FILE *input = fopen(state->generation_path, "re");
  unsigned long long parsed;
  if (!input) {
    state->generation_state = errno == ENOENT ? GENERATION_MISSING : GENERATION_IO_ERROR;
    return;
  }
  if (!fgets(buffer, sizeof(buffer), input)) {
    state->generation_state = ferror(input) ? GENERATION_IO_ERROR : GENERATION_MALFORMED;
    fclose(input);
    return;
  }
  fclose(input);
  errno = 0;
  parsed = strtoull(buffer, &end, 10);
  while (end && (*end == ' ' || *end == '\t' || *end == '\r' || *end == '\n')) end++;
  if (errno != 0 || end == buffer || (end && *end != '\0')) {
    state->generation_state = GENERATION_MALFORMED;
    return;
  }
  if ((uint64_t)parsed > state->generation_floor) state->generation_floor = (uint64_t)parsed;
  state->generation_state = GENERATION_OK;
}

/* The Shell writes this sibling marker before it asks the Helper to reveal a
 * resident provider.  The daemon is intentionally single-threaded, so queued
 * Guard inspections must yield without starting an X11 transaction; otherwise
 * they can delay that foreground request by several inspect deadlines. */
static bool foreground_switch_marker_active(const HelperState *state) {
  char marker_path[PATH_MAX];
  char buffer[128];
  const char *slash;
  char *end = NULL;
  FILE *input;
  long parsed;
  int written;
  slash = strrchr(state->generation_path, '/');
  if (!slash) return false;
  if (slash == state->generation_path) {
    written = snprintf(marker_path, sizeof(marker_path), "/provider-switch.pid");
  } else {
    written = snprintf(marker_path, sizeof(marker_path), "%.*s/provider-switch.pid",
                       (int)(slash - state->generation_path), state->generation_path);
  }
  if (written < 0 || (size_t)written >= sizeof(marker_path)) return false;
  input = fopen(marker_path, "re");
  if (!input) return false;
  if (!fgets(buffer, sizeof(buffer), input)) {
    fclose(input);
    return false;
  }
  fclose(input);
  errno = 0;
  parsed = strtol(buffer, &end, 10);
  while (end && (*end == ' ' || *end == '\t' || *end == '\r' || *end == '\n')) end++;
  if (errno != 0 || end == buffer || (end && *end != '\0') || parsed <= 1 ||
      parsed > INT_MAX) return false;
  if (kill((pid_t)parsed, 0) == 0) return true;
  return errno == EPERM;
}

static void load_instance_id(char output[80]) {
  FILE *input = fopen("/proc/sys/kernel/random/uuid", "re");
  if (input && fgets(output, 80, input)) {
    output[strcspn(output, "\r\n")] = '\0';
    fclose(input);
    if (output[0]) return;
  } else if (input) {
    fclose(input);
  }
  snprintf(output, 80, "pid-%ld-%" PRId64, (long)getpid(), monotonic_ms());
}

static void capture_async_error(AsyncError *target, const xcb_generic_error_t *error) {
  if (!target || !error || target->seen) return;
  target->seen = true;
  target->error_code = error->error_code;
  target->major_code = error->major_code;
  target->minor_code = error->minor_code;
  target->resource_id = error->resource_id;
  target->sequence = error->sequence;
}

static const char *watch_repair_scope_name(WatchRepairScope scope) {
  switch (scope) {
    case WATCH_REPAIR_OBSERVE: return "observe";
    case WATCH_REPAIR_PANEL: return "panel";
    case WATCH_REPAIR_PROVIDER: return "provider";
  }
  return "observe";
}

static bool watch_repair_scope_has_writes(const HelperState *state) {
  return state->watch_repair_scope != WATCH_REPAIR_OBSERVE;
}

/* Repairs are dispatched only by the daemon event loop, never while a client
 * request is collecting replies.  The declaration lives here because event
 * observation intentionally precedes the bounded query/mutation helpers. */
static void repair_watched_surfaces(HelperState *state);

static void invalidate_watch(HelperState *state, const char *reason) {
  state->watch_valid = false;
  state->watch_repair_pending = false;
  snprintf(state->watch_invalid_reason, sizeof(state->watch_invalid_reason), "%s",
           reason && reason[0] ? reason : "WATCH_INVALID");
}

static void refresh_watch_validity(HelperState *state) {
  if (!state->watch_valid) return;
  if (state->watch_epoch != state->connection_epoch) {
    invalidate_watch(state, "CONNECTION_EPOCH_MISMATCH");
  } else if (state->generation_state != GENERATION_OK ||
             state->watch_generation != state->generation_floor) {
    invalidate_watch(state, "GENERATION_ADVANCED");
  } else if (monotonic_ns() >= state->watch_expires_ns) {
    invalidate_watch(state, "LEASE_EXPIRED");
  }
}

static int watch_surface_index(const HelperState *state, xcb_window_t xid) {
  for (size_t index = 0; index < state->watch_surface_count; index++) {
    if (state->watch_surfaces[index] == xid) return (int)index;
  }
  return -1;
}

static bool watch_property_managed(const HelperState *state, xcb_atom_t property) {
  return property == state->net_wm_pid || property == XCB_ATOM_WM_CLASS ||
         property == state->net_wm_opacity;
}

static const char *watch_event_type_name(uint8_t response_type) {
  switch (response_type) {
    case XCB_CONFIGURE_NOTIFY: return "ConfigureNotify";
    case XCB_MAP_NOTIFY: return "MapNotify";
    case XCB_UNMAP_NOTIFY: return "UnmapNotify";
    case XCB_DESTROY_NOTIFY: return "DestroyNotify";
    case XCB_PROPERTY_NOTIFY: return "PropertyNotify";
    case XCB_REPARENT_NOTIFY: return "ReparentNotify";
  }
  return NULL;
}

static bool watch_event_already_reported(const HelperState *state, uint16_t sequence,
                                         uint8_t response_type, xcb_window_t xid,
                                         xcb_atom_t property) {
  for (size_t index = 0; index < state->watch_event_history_count; index++) {
    const WatchEvent *event = &state->watch_event_history[index];
    if (event->sequence == sequence && event->response_type == response_type &&
        event->xid == xid && event->property == property) return true;
  }
  return false;
}

static void record_watch_event(HelperState *state, uint16_t sequence, uint8_t response_type,
                               xcb_window_t xid, xcb_atom_t property, bool root_forwarded,
                               bool would_repair, const char *role) {
  WatchEvent *entry;
  const char *type = watch_event_type_name(response_type);
  if (!type || watch_event_already_reported(state, sequence, response_type, xid, property)) {
    state->watch_events_duplicate_dropped++;
    return;
  }
  entry = &state->watch_event_history[
    state->next_watch_event_slot++ % MAX_WATCH_EVENT_HISTORY];
  *entry = (WatchEvent){
    .sequence = sequence,
    .response_type = response_type,
    .xid = xid,
    .property = property,
    .root_forwarded = root_forwarded,
    .would_repair = would_repair,
  };
  snprintf(entry->role, sizeof(entry->role), "%s", role);
  snprintf(entry->type, sizeof(entry->type), "%s", type);
  if (state->watch_event_history_count < MAX_WATCH_EVENT_HISTORY) {
    state->watch_event_history_count++;
  }
  state->watch_events_reported++;
  if (would_repair) state->watch_events_would_repair++;
}

static void observe_xcb_event(HelperState *state, const xcb_generic_event_t *event) {
  uint8_t response_type;
  xcb_window_t xid = XCB_WINDOW_NONE;
  xcb_window_t recipient = XCB_WINDOW_NONE;
  xcb_atom_t property = XCB_ATOM_NONE;
  bool root_forwarded;
  int surface_index;
  if (!event || (event->response_type & 0x7fU) == 0) return;
  response_type = event->response_type & 0x7fU;
  if (!watch_event_type_name(response_type)) return;
  switch (response_type) {
    case XCB_CONFIGURE_NOTIFY: {
      const xcb_configure_notify_event_t *value = (const xcb_configure_notify_event_t *)event;
      xid = value->window;
      recipient = value->event;
      break;
    }
    case XCB_MAP_NOTIFY: {
      const xcb_map_notify_event_t *value = (const xcb_map_notify_event_t *)event;
      xid = value->window;
      recipient = value->event;
      break;
    }
    case XCB_UNMAP_NOTIFY: {
      const xcb_unmap_notify_event_t *value = (const xcb_unmap_notify_event_t *)event;
      xid = value->window;
      recipient = value->event;
      break;
    }
    case XCB_DESTROY_NOTIFY: {
      const xcb_destroy_notify_event_t *value = (const xcb_destroy_notify_event_t *)event;
      xid = value->window;
      recipient = value->event;
      break;
    }
    case XCB_PROPERTY_NOTIFY: {
      const xcb_property_notify_event_t *value = (const xcb_property_notify_event_t *)event;
      xid = value->window;
      property = value->atom;
      recipient = xid;
      break;
    }
    case XCB_REPARENT_NOTIFY: {
      const xcb_reparent_notify_event_t *value = (const xcb_reparent_notify_event_t *)event;
      xid = value->window;
      recipient = value->event;
      break;
    }
  }
  load_generation_floor(state);
  refresh_watch_validity(state);
  if (!state->watch_valid) {
    if (state->watch_lease_id[0]) state->watch_events_stale_dropped++;
    return;
  }
  state->watch_events_received++;
  surface_index = watch_surface_index(state, xid);
  if (surface_index < 0 ||
      (response_type == XCB_PROPERTY_NOTIFY && !watch_property_managed(state, property))) {
    state->watch_events_unrelated_dropped++;
    return;
  }
  root_forwarded = state->screen && recipient == state->screen->root;
  record_watch_event(state, event->sequence, response_type, xid, property, root_forwarded, true,
                     state->watch_roles[surface_index]);
  if (response_type == XCB_DESTROY_NOTIFY) {
    invalidate_watch(state, "WATCHED_WINDOW_DESTROYED");
  } else if (watch_repair_scope_has_writes(state) &&
             response_type == XCB_PROPERTY_NOTIFY &&
             (property == state->net_wm_pid || property == XCB_ATOM_WM_CLASS)) {
    invalidate_watch(state, "WATCHED_WINDOW_IDENTITY_CHANGED");
  } else if (watch_repair_scope_has_writes(state) && response_type == XCB_UNMAP_NOTIFY &&
             (state->watch_repair_scope == WATCH_REPAIR_PANEL ||
              strcmp(state->watch_roles[surface_index], "active") == 0 ||
              strcmp(state->watch_roles[surface_index], "panel") == 0)) {
    invalidate_watch(state, "WATCHED_WINDOW_UNMAPPED");
  } else if (watch_repair_scope_has_writes(state)) {
    /* Configure, reparent and opacity/map events are coalesced into a single
     * bounded snapshot.  A failed snapshot revokes this write lease instead
     * of discovering or touching any unleased window. */
    state->watch_repair_pending = true;
  }
}

static void drain_queued_events(HelperState *state, AsyncError *async_error) {
  xcb_generic_event_t *event;
  while ((event = xcb_poll_for_queued_event(state->connection)) != NULL) {
    if ((event->response_type & 0x7fU) == 0) {
      capture_async_error(async_error, (xcb_generic_error_t *)event);
    } else {
      observe_xcb_event(state, event);
    }
    free(event);
  }
}

static size_t scan_pending_replies(HelperState *state, PendingReply *pending, size_t count,
                                   bool *progressed) {
  size_t completed = 0;
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  if (self_test_defer_reply_scan_once) {
    self_test_defer_reply_scan_once = false;
    for (size_t index = 0; index < count; index++) {
      if (pending[index].done) completed++;
    }
    return completed;
  }
#endif
  for (size_t index = 0; index < count; index++) {
    void *reply = NULL;
    xcb_generic_error_t *error = NULL;
    int ready;
    if (pending[index].done) {
      completed++;
      continue;
    }
    ready = xcb_poll_for_reply(state->connection, pending[index].sequence, &reply, &error);
    if (ready) {
      pending[index].reply = reply;
      pending[index].error = error;
      pending[index].done = true;
      completed++;
      *progressed = true;
    }
  }
  return completed;
}

static void snapshot_pending_diagnostics(CollectorDiagnostics *diagnostics,
                                         const PendingReply *pending, size_t count) {
  diagnostics->pending_diagnostic_count = count > MAX_PENDING ? MAX_PENDING : count;
  for (size_t index = 0; index < diagnostics->pending_diagnostic_count; index++) {
    diagnostics->pending[index] = (PendingDiagnostic){
      .sequence = pending[index].sequence,
      .kind = pending[index].kind,
      .surface_index = pending[index].surface_index,
      .done = pending[index].done,
      .reply_ready = pending[index].reply != NULL,
      .error_ready = pending[index].error != NULL,
    };
  }
}

static CollectResult finish_collect(HelperState *state, CollectResult result,
                                    const PendingReply *pending, size_t pending_count,
                                    size_t completed) {
  CollectorDiagnostics *diagnostics = &state->last_collect;
  diagnostics->result = result;
  diagnostics->completed_count = completed;
  snapshot_pending_diagnostics(diagnostics, pending, pending_count);
  diagnostics->connection_error = state->connection
    ? xcb_connection_has_error(state->connection) : XCB_CONN_ERROR;
  diagnostics->stop_requested = stop_requested != 0;
  return result;
}

static CollectResult final_reply_scan(HelperState *state, PendingReply *pending, size_t count,
                                      AsyncError *async_error) {
  CollectorDiagnostics *diagnostics = &state->last_collect;
  bool progressed = false;
  size_t completed;
  diagnostics->final_scan = true;
  completed = scan_pending_replies(state, pending, count, &progressed);
  diagnostics->final_scan_progressed = progressed;
  drain_queued_events(state, async_error);
  if (stop_requested) return finish_collect(state, COLLECT_INTERRUPTED, pending, count, completed);
  if (xcb_connection_has_error(state->connection) != 0) {
    return finish_collect(state, COLLECT_XCB_CONNECTION_ERROR, pending, count, completed);
  }
  return finish_collect(state, completed == count ? COLLECT_OK : COLLECT_REPLY_TIMEOUT,
                        pending, count, completed);
}

static CollectResult collect_replies(HelperState *state, PendingReply *pending, size_t count,
                                     int64_t deadline_ns, AsyncError *async_error) {
  struct pollfd descriptor = {0};
  CollectorDiagnostics *diagnostics = &state->last_collect;
  descriptor.fd = xcb_get_file_descriptor(state->connection);
  descriptor.events = POLLIN | POLLERR | POLLHUP;
  *diagnostics = (CollectorDiagnostics){.result = COLLECT_OK, .pending_count = count};

  for (;;) {
    bool progressed = false;
    size_t completed;
    int remaining_ms;
    int poll_result;
    if (stop_requested) return finish_collect(state, COLLECT_INTERRUPTED, pending, count, 0);
    completed = scan_pending_replies(state, pending, count, &progressed);
    drain_queued_events(state, async_error);
    if (xcb_connection_has_error(state->connection) != 0) {
      return finish_collect(state, COLLECT_XCB_CONNECTION_ERROR, pending, count, completed);
    }
    if (completed == count) return finish_collect(state, COLLECT_OK, pending, count, completed);
    remaining_ms = remaining_timeout_ms(deadline_ns);
    if (remaining_ms <= 0) return final_reply_scan(state, pending, count, async_error);
    if (progressed) continue;

    descriptor.revents = 0;
    diagnostics->poll_errno = 0;
    diagnostics->poll_revents = 0;
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
    if (self_test_force_poll_timeout_once) {
      self_test_force_poll_timeout_once = false;
      poll_result = 0;
    } else
#endif
    {
      poll_result = poll(&descriptor, 1, remaining_ms);
    }
    if (poll_result == 0) return final_reply_scan(state, pending, count, async_error);
    if (poll_result < 0) {
      diagnostics->poll_errno = errno;
      if (errno == EINTR) {
        if (stop_requested) {
          return finish_collect(state, COLLECT_INTERRUPTED, pending, count, completed);
        }
        continue;
      }
      return finish_collect(state, COLLECT_POLL_ERROR, pending, count, completed);
    }
    diagnostics->poll_revents = descriptor.revents;
    if (descriptor.revents & (POLLERR | POLLHUP | POLLNVAL)) {
      progressed = false;
      completed = scan_pending_replies(state, pending, count, &progressed);
      drain_queued_events(state, async_error);
      if (stop_requested) return finish_collect(state, COLLECT_INTERRUPTED, pending, count, completed);
      if (xcb_connection_has_error(state->connection) != 0) {
        return finish_collect(state, COLLECT_XCB_CONNECTION_ERROR, pending, count, completed);
      }
      if (completed == count) return finish_collect(state, COLLECT_OK, pending, count, completed);
      return finish_collect(state, COLLECT_POLL_ERROR, pending, count, completed);
    }
  }
}

/* A physical display probe needs one large GetImage reply rather than the
 * surface-query bundle above.  Keep its reply wait bounded and nonblocking so
 * an overloaded X server cannot monopolise the Helper daemon. */
static CollectResult collect_single_reply(HelperState *state, uint32_t sequence,
                                          int64_t deadline_ns, void **reply_output,
                                          xcb_generic_error_t **error_output) {
  struct pollfd descriptor = {0};
  AsyncError async_error = {0};
  descriptor.fd = xcb_get_file_descriptor(state->connection);
  descriptor.events = POLLIN | POLLERR | POLLHUP;
  *reply_output = NULL;
  *error_output = NULL;
  for (;;) {
    void *reply = NULL;
    xcb_generic_error_t *error = NULL;
    int ready = xcb_poll_for_reply(state->connection, sequence, &reply, &error);
    if (ready) {
      *reply_output = reply;
      *error_output = error;
      return error ? SURFACE_QUERY_FAILED : COLLECT_OK;
    }
    drain_queued_events(state, &async_error);
    if (async_error.seen || xcb_connection_has_error(state->connection) != 0) {
      return COLLECT_XCB_CONNECTION_ERROR;
    }
    int remaining_ms = remaining_timeout_ms(deadline_ns);
    if (remaining_ms <= 0) return COLLECT_REPLY_TIMEOUT;
    descriptor.revents = 0;
    int poll_result = poll(&descriptor, 1, remaining_ms);
    if (poll_result == 0) return COLLECT_REPLY_TIMEOUT;
    if (poll_result < 0) {
      if (errno == EINTR) continue;
      return COLLECT_POLL_ERROR;
    }
    if (descriptor.revents & (POLLERR | POLLHUP | POLLNVAL)) {
      return COLLECT_XCB_CONNECTION_ERROR;
    }
  }
}

static void free_pending(PendingReply *pending, size_t count) {
  for (size_t index = 0; index < count; index++) {
    free(pending[index].reply);
    free(pending[index].error);
  }
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

static int intern_required_atoms(HelperState *state, int64_t deadline_ns) {
  PendingReply pending[2] = {0};
  AsyncError async_error = {0};
  xcb_intern_atom_cookie_t pid_cookie = xcb_intern_atom(state->connection, 0, 11, "_NET_WM_PID");
  xcb_intern_atom_cookie_t opacity_cookie = xcb_intern_atom(state->connection, 0, 22, "_NET_WM_WINDOW_OPACITY");
  pending[0] = (PendingReply){.sequence = pid_cookie.sequence};
  pending[1] = (PendingReply){.sequence = opacity_cookie.sequence};
  if (xcb_flush(state->connection) <= 0 ||
      collect_replies(state, pending, 2, deadline_ns, &async_error) != 0 || async_error.seen ||
      pending[0].error || pending[1].error || !pending[0].reply || !pending[1].reply) {
    free_pending(pending, 2);
    return -1;
  }
  state->net_wm_pid = ((xcb_intern_atom_reply_t *)pending[0].reply)->atom;
  state->net_wm_opacity = ((xcb_intern_atom_reply_t *)pending[1].reply)->atom;
  free_pending(pending, 2);
  return state->net_wm_pid == XCB_ATOM_NONE || state->net_wm_opacity == XCB_ATOM_NONE ? -1 : 0;
}

static int connect_xcb(HelperState *state, bool reconnecting, int64_t deadline_ns) {
  int screen_number = 0;
  xcb_connection_t *connection = xcb_connect(state->display[0] ? state->display : NULL, &screen_number);
  if (!connection || xcb_connection_has_error(connection) != 0) {
    if (connection) xcb_disconnect(connection);
    return -1;
  }
  state->connection = connection;
  state->screen = screen_for_number(connection, screen_number);
  if (!state->screen || intern_required_atoms(state, deadline_ns) != 0) {
    xcb_disconnect(connection);
    state->connection = NULL;
    state->screen = NULL;
    return -1;
  }
  state->connection_epoch++;
  state->watch_valid = false;
  snprintf(state->watch_invalid_reason, sizeof(state->watch_invalid_reason), "%s",
           reconnecting ? "XCB_RECONNECTED" : "NOT_WATCHING");
  if (reconnecting) state->reconnects++;
  return 0;
}

static void release_lease(HelperState *state) {
  state->lease_active = false;
  state->lease_id[0] = '\0';
  state->lease_generation = 0;
  state->lease_epoch = 0;
  state->lease_expires_ns = 0;
  state->lease_surface_count = 0;
  memset(state->lease_surfaces, 0, sizeof(state->lease_surfaces));
  state->mutation_started = false;
}

static void reset_xcb_connection(HelperState *state) {
  if (state->connection) xcb_disconnect(state->connection);
  state->connection = NULL;
  state->screen = NULL;
  state->watch_valid = false;
  snprintf(state->watch_invalid_reason, sizeof(state->watch_invalid_reason), "%s",
           "XCB_RECONNECTED");
  release_lease(state);
  state->connection_epoch++;
}

static bool profile_path_matches(const char *candidate, const char *profile,
                                 const char *canonical_profile) {
  char canonical_candidate[PATH_MAX];
  if (!candidate || !candidate[0]) return false;
  if (strcmp(candidate, profile) == 0) return true;
  if (canonical_profile && canonical_profile[0] &&
      realpath(candidate, canonical_candidate) &&
      strcmp(canonical_candidate, canonical_profile) == 0) {
    return true;
  }
  return false;
}

static bool profile_path_slice_matches(const char *candidate, size_t length, const char *profile,
                                       const char *canonical_profile) {
  char value[PATH_MAX];
  if (length == 0 || length >= sizeof(value)) return false;
  memcpy(value, candidate, length);
  value[length] = '\0';
  return profile_path_matches(value, profile, canonical_profile);
}

static bool command_argument_matches_profile(const char *argument, size_t argument_length,
                                             const char *profile, const char *canonical_profile) {
  const char prefix[] = "--user-data-dir=";
  const char flag[] = "--user-data-dir";
  const char *cursor = argument;
  const char *end = argument + argument_length;
  while (cursor < end) {
    const char *token_end;
    while (cursor < end && isspace((unsigned char)*cursor)) cursor++;
    if (cursor == end) break;
    token_end = cursor;
    while (token_end < end && !isspace((unsigned char)*token_end)) token_end++;
    if ((size_t)(token_end - cursor) > sizeof(prefix) - 1 &&
        memcmp(cursor, prefix, sizeof(prefix) - 1) == 0 &&
        profile_path_slice_matches(cursor + sizeof(prefix) - 1,
                                   (size_t)(token_end - cursor) - (sizeof(prefix) - 1),
                                   profile, canonical_profile)) {
      return true;
    }
    if ((size_t)(token_end - cursor) == sizeof(flag) - 1 &&
        memcmp(cursor, flag, sizeof(flag) - 1) == 0) {
      cursor = token_end;
      while (cursor < end && isspace((unsigned char)*cursor)) cursor++;
      token_end = cursor;
      while (token_end < end && !isspace((unsigned char)*token_end)) token_end++;
      return profile_path_slice_matches(cursor, (size_t)(token_end - cursor),
                                        profile, canonical_profile);
    }
    cursor = token_end;
  }
  return false;
}

static bool command_line_matches_profile(const char *buffer, ssize_t length, const char *profile,
                                         const char *canonical_profile) {
  const char prefix[] = "--user-data-dir=";
  ssize_t offset = 0;
  bool next_is_profile = false;
  while (offset < length) {
    const char *argument = buffer + offset;
    size_t available = (size_t)(length - offset);
    size_t argument_length = strnlen(argument, available);
    if (argument_length == available) return false;
    if (next_is_profile) {
      return profile_path_matches(argument, profile, canonical_profile);
    }
    if (strcmp(argument, "--user-data-dir") == 0) {
      next_is_profile = true;
    } else if (strncmp(argument, prefix, sizeof(prefix) - 1) == 0 &&
               profile_path_matches(argument + sizeof(prefix) - 1, profile, canonical_profile)) {
      return true;
    } else if (command_argument_matches_profile(argument, argument_length,
                                                profile, canonical_profile)) {
      return true;
    }
    offset += (ssize_t)argument_length + 1;
  }
  return false;
}

static bool read_proc_identity(uint32_t pid, uid_t *uid, uint32_t *parent,
                               unsigned long long *starttime) {
#ifdef TIKPAL_X11_HELPER_LOCAL_FIXTURE
  if (uid) *uid = geteuid();
  if (parent) *parent = 1;
  if (starttime) *starttime = pid;
  return pid != 0;
#endif
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  if (self_test_identity_pid != 0 && pid == self_test_identity_pid) {
    if (pid == self_test_identity_fault_pid &&
        self_test_identity_mode == SELF_TEST_IDENTITY_UNAVAILABLE) return false;
    if (uid) {
      *uid = pid == self_test_identity_fault_pid &&
             self_test_identity_mode == SELF_TEST_IDENTITY_UID_MISMATCH
        ? geteuid() + 1 : geteuid();
    }
    if (parent) *parent = (uint32_t)getppid();
    if (starttime) {
      self_test_identity_read_count++;
      *starttime = pid == self_test_identity_fault_pid &&
                   self_test_identity_mode == SELF_TEST_IDENTITY_STARTTIME_CHANGE &&
                   self_test_identity_read_count > 1 ? 2 : 1;
    }
    return true;
  }
#endif
  char path[64];
  char line[8192];
  char *cursor;
  char *right_parenthesis;
  FILE *input;
  struct stat status;
  unsigned field = 3;
  snprintf(path, sizeof(path), "/proc/%u", pid);
  if (stat(path, &status) != 0) return false;
  if (uid) *uid = status.st_uid;
  snprintf(path, sizeof(path), "/proc/%u/stat", pid);
  input = fopen(path, "re");
  if (!input || !fgets(line, sizeof(line), input)) {
    if (input) fclose(input);
    return false;
  }
  fclose(input);
  right_parenthesis = strrchr(line, ')');
  if (!right_parenthesis || right_parenthesis[1] != ' ') return false;
  cursor = right_parenthesis + 2;
  while (*cursor && field <= 22) {
    char *end;
    while (*cursor == ' ') cursor++;
    if (!*cursor) return false;
    if (field == 4) {
      unsigned long value = strtoul(cursor, &end, 10);
      if (end == cursor || value > UINT32_MAX) return false;
      if (parent) *parent = (uint32_t)value;
    } else if (field == 22) {
      unsigned long long value = strtoull(cursor, &end, 10);
      if (end == cursor) return false;
      if (starttime) *starttime = value;
    } else {
      end = cursor;
      while (*end && *end != ' ') end++;
    }
    cursor = end;
    field++;
  }
  return field > 22;
}

static bool pid_tree_matches_profile(uint32_t initial_pid, const char *profile, int64_t deadline_ns) {
#ifdef TIKPAL_X11_HELPER_LOCAL_FIXTURE
  (void)deadline_ns;
  return initial_pid != 0 && profile && profile[0];
#endif
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  if (self_test_identity_pid != 0 && initial_pid == self_test_identity_pid) {
    return self_test_identity_profile && strcmp(profile, self_test_identity_profile) == 0;
  }
#endif
  uint32_t pid = initial_pid;
  char canonical_profile[PATH_MAX] = "";
  char path[64];
  char command_line[65536];
  if (!realpath(profile, canonical_profile)) canonical_profile[0] = '\0';

  for (int depth = 0; depth < 16 && pid > 1; depth++) {
    int descriptor;
    ssize_t length;
    uint32_t parent = 0;
    if (remaining_timeout_ms(deadline_ns) <= 0) return false;
    snprintf(path, sizeof(path), "/proc/%u/cmdline", pid);
    descriptor = open(path, O_RDONLY | O_CLOEXEC);
    if (descriptor >= 0) {
      length = read(descriptor, command_line, sizeof(command_line) - 1);
      close(descriptor);
      if (length > 0) {
        command_line[length] = '\0';
        if (command_line_matches_profile(command_line, length, profile, canonical_profile)) return true;
      }
    }
    if (!read_proc_identity(pid, NULL, &parent, NULL) || parent == 0 || parent == pid) break;
    pid = parent;
  }
  return false;
}

static bool wm_class_is_chromium(const SurfaceResult *surface) {
  static const char *allowed[] = {"chromium", "chromium-browser", "google-chrome"};
  if (!surface->class_property || surface->class_property->type != XCB_ATOM_STRING ||
      surface->class_property->format != 8 || !surface->class_instance[0] || !surface->class_name[0]) {
    return false;
  }
  for (size_t index = 0; index < sizeof(allowed) / sizeof(allowed[0]); index++) {
    if (strcasecmp(surface->class_instance, allowed[index]) == 0 ||
        strcasecmp(surface->class_name, allowed[index]) == 0) {
      return true;
    }
  }
  return false;
}

static void copy_wm_class(SurfaceResult *surface) {
  int length;
  const char *value;
  size_t first_length;
  if (!surface->class_property || surface->class_property->format != 8) return;
  length = xcb_get_property_value_length(surface->class_property);
  value = xcb_get_property_value(surface->class_property);
  if (!value || length <= 0) return;
  first_length = strnlen(value, (size_t)length);
  snprintf(surface->class_instance, sizeof(surface->class_instance), "%.*s",
           (int)(first_length < MAX_CLASS - 1 ? first_length : MAX_CLASS - 1), value);
  if (first_length + 1 < (size_t)length) {
    const char *second = value + first_length + 1;
    size_t remaining = (size_t)length - first_length - 1;
    size_t second_length = strnlen(second, remaining);
    snprintf(surface->class_name, sizeof(surface->class_name), "%.*s",
             (int)(second_length < MAX_CLASS - 1 ? second_length : MAX_CLASS - 1), second);
  }
}

static void parse_surface_result(SurfaceResult *surface, int64_t deadline_ns,
                                 bool verify_profile_identity) {
  surface->code = "OK";
  surface->opacity = UINT32_MAX;
  surface->opacity_full = true;

  if (surface->first_error) {
    surface->code = "XCB_REQUEST_ERROR";
    return;
  }
  if (!surface->geometry || !surface->translate || !surface->attributes ||
      !surface->pid_property || !surface->class_property || !surface->opacity_property || !surface->tree) {
    surface->code = "INCOMPLETE_XCB_REPLY";
    return;
  }
  if (surface->pid_property->type == XCB_ATOM_CARDINAL && surface->pid_property->format == 32 &&
      surface->pid_property->bytes_after == 0 &&
      xcb_get_property_value_length(surface->pid_property) == (int)sizeof(uint32_t)) {
    memcpy(&surface->pid, xcb_get_property_value(surface->pid_property), sizeof(uint32_t));
  }
  if (surface->pid == 0) {
    surface->code = "WINDOW_PID_MISSING";
    return;
  }
  copy_wm_class(surface);
  surface->class_matched = wm_class_is_chromium(surface);
  if (!surface->class_matched) {
    surface->code = "WINDOW_CLASS_MISMATCH";
    return;
  }
  surface->map_viewable = surface->attributes->map_state == XCB_MAP_STATE_VIEWABLE;
  if (!surface->map_viewable) {
    surface->code = "WINDOW_NOT_VIEWABLE";
    return;
  }
  surface->geometry_usable = surface->geometry->width > 0 && surface->geometry->height > 0 &&
      (uint64_t)surface->geometry->width * surface->geometry->height > 100000;
  if (!surface->geometry_usable) {
    surface->code = "WINDOW_GEOMETRY_INVALID";
    return;
  }
  if (surface->geometry->root != surface->tree->root || surface->tree->root == XCB_WINDOW_NONE) {
    surface->code = "WINDOW_ROOT_MISMATCH";
    return;
  }
  if (surface->opacity_property->type != XCB_ATOM_NONE &&
      (surface->opacity_property->type != XCB_ATOM_CARDINAL ||
       surface->opacity_property->format != 32 || surface->opacity_property->bytes_after != 0 ||
       xcb_get_property_value_length(surface->opacity_property) != (int)sizeof(uint32_t))) {
    surface->code = "WINDOW_OPACITY_INVALID";
    return;
  }
  if (surface->opacity_property->type != XCB_ATOM_NONE) {
    surface->opacity_present = true;
    memcpy(&surface->opacity, xcb_get_property_value(surface->opacity_property), sizeof(uint32_t));
    surface->opacity_full = surface->opacity == UINT32_MAX;
  }
  if (!verify_profile_identity) {
    surface->ok = true;
    return;
  }
  if (!read_proc_identity(surface->pid, &surface->uid, NULL, &surface->pid_starttime)) {
    surface->code = "WINDOW_PID_IDENTITY_UNAVAILABLE";
    return;
  }
  if (surface->uid != geteuid()) {
    surface->code = "WINDOW_UID_MISMATCH";
    return;
  }
  surface->profile_matched = pid_tree_matches_profile(surface->pid, surface->request.profile, deadline_ns);
  if (!surface->profile_matched) {
    surface->code = remaining_timeout_ms(deadline_ns) <= 0
      ? "TRANSACTION_DEADLINE_EXCEEDED"
      : "WINDOW_PROFILE_MISMATCH";
    return;
  }
  unsigned long long verified_starttime = 0;
  if (!read_proc_identity(surface->pid, NULL, NULL, &verified_starttime) ||
      verified_starttime != surface->pid_starttime) {
    surface->code = "WINDOW_PID_REUSED";
    return;
  }
  surface->ok = true;
}

static void assign_pending_reply(SurfaceResult *surfaces, PendingReply *pending) {
  SurfaceResult *surface = &surfaces[pending->surface_index];
  if (pending->error && !surface->first_error) surface->first_error = pending->error;
  switch (pending->kind) {
    case PENDING_GEOMETRY: surface->geometry = pending->reply; break;
    case PENDING_TRANSLATE: surface->translate = pending->reply; break;
    case PENDING_ATTRIBUTES: surface->attributes = pending->reply; break;
    case PENDING_PID: surface->pid_property = pending->reply; break;
    case PENDING_CLASS: surface->class_property = pending->reply; break;
    case PENDING_OPACITY: surface->opacity_property = pending->reply; break;
    case PENDING_TREE: surface->tree = pending->reply; break;
  }
  pending->reply = NULL;
  if (pending->error == surface->first_error) pending->error = NULL;
}

static void free_surface_results(SurfaceResult *surfaces, size_t count) {
  for (size_t index = 0; index < count; index++) {
    free(surfaces[index].geometry);
    free(surfaces[index].translate);
    free(surfaces[index].attributes);
    free(surfaces[index].pid_property);
    free(surfaces[index].class_property);
    free(surfaces[index].opacity_property);
    free(surfaces[index].tree);
    free(surfaces[index].first_error);
  }
}

static void clear_surface_result_data(SurfaceResult *surface) {
  SurfaceRequest request = surface->request;
  free_surface_results(surface, 1);
  memset(surface, 0, sizeof(*surface));
  surface->request = request;
}

static size_t queue_surface_queries(HelperState *state, SurfaceResult *surfaces, size_t count,
                                    PendingReply pending[MAX_PENDING]) {
  size_t pending_count = 0;
  for (size_t index = 0; index < count; index++) {
    xcb_get_geometry_cookie_t geometry =
      xcb_get_geometry(state->connection, surfaces[index].request.xid);
    xcb_translate_coordinates_cookie_t translate =
      xcb_translate_coordinates(state->connection, surfaces[index].request.xid,
                                state->screen->root, 0, 0);
    xcb_get_window_attributes_cookie_t attributes =
      xcb_get_window_attributes(state->connection, surfaces[index].request.xid);
    xcb_get_property_cookie_t pid =
      xcb_get_property(state->connection, 0, surfaces[index].request.xid,
                       state->net_wm_pid, XCB_ATOM_CARDINAL, 0, 1);
    xcb_get_property_cookie_t class_value =
      xcb_get_property(state->connection, 0, surfaces[index].request.xid,
                       XCB_ATOM_WM_CLASS, XCB_ATOM_STRING, 0, MAX_CLASS / 4);
    xcb_get_property_cookie_t opacity =
      xcb_get_property(state->connection, 0, surfaces[index].request.xid,
                       state->net_wm_opacity, XCB_ATOM_CARDINAL, 0, 1);
    xcb_query_tree_cookie_t tree =
      xcb_query_tree(state->connection, surfaces[index].request.xid);
    pending[pending_count++] = (PendingReply){
      .sequence = geometry.sequence, .kind = PENDING_GEOMETRY, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = translate.sequence, .kind = PENDING_TRANSLATE, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = attributes.sequence, .kind = PENDING_ATTRIBUTES, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = pid.sequence, .kind = PENDING_PID, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = class_value.sequence, .kind = PENDING_CLASS, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = opacity.sequence, .kind = PENDING_OPACITY, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = tree.sequence, .kind = PENDING_TREE, .surface_index = index
    };
  }
  return pending_count;
}

static int finish_surface_queries(HelperState *state, SurfaceResult *surfaces, size_t surface_count,
                                  PendingReply pending[MAX_PENDING], size_t pending_count,
                                  int64_t deadline_ns, AsyncError *async_error,
                                  bool verify_profile_identity) {
  int collect_result = collect_replies(state, pending, pending_count, deadline_ns, async_error);
  if (collect_result != 0) {
    free_pending(pending, pending_count);
    return collect_result;
  }
  for (size_t index = 0; index < pending_count; index++) {
    assign_pending_reply(surfaces, &pending[index]);
  }
  free_pending(pending, pending_count);
  if (!verify_profile_identity) {
    bool all_ok = !async_error->seen;
    for (size_t index = 0; index < surface_count; index++) {
      parse_surface_result(&surfaces[index], deadline_ns, false);
      if (!surfaces[index].ok) all_ok = false;
    }
    return all_ok ? 0 : SURFACE_QUERY_FAILED;
  }
  bool all_ok = true;
  for (size_t index = 0; index < surface_count; index++) {
    parse_surface_result(&surfaces[index], deadline_ns, true);
    if (!surfaces[index].ok) all_ok = false;
  }
  if (remaining_timeout_ms(deadline_ns) <= 0) return SURFACE_QUERY_DEADLINE_EXCEEDED;
  return async_error->seen || !all_ok ? SURFACE_QUERY_FAILED : 0;
}

static void add_xcb_error_json(json_object *target, const xcb_generic_error_t *error) {
  if (!error) return;
  json_object *value = json_object_new_object();
  json_object_object_add(value, "errorCode", json_object_new_int(error->error_code));
  json_object_object_add(value, "majorCode", json_object_new_int(error->major_code));
  json_object_object_add(value, "minorCode", json_object_new_int(error->minor_code));
  json_object_object_add(value, "sequence", json_object_new_int(error->sequence));
  json_object_object_add(value, "resourceId", json_object_new_int64(error->resource_id));
  json_object_object_add(target, "xcbError", value);
}

static json_object *surface_to_json(const SurfaceResult *surface) {
  json_object *output = json_object_new_object();
  json_object *geometry = json_object_new_object();
  json_object *opacity = json_object_new_object();
  json_object_object_add(output, "role", json_object_new_string(surface->request.role));
  json_object_object_add(output, "xid", json_object_new_int64(surface->request.xid));
  json_object_object_add(output, "profile", json_object_new_string(surface->request.profile));
  json_object_object_add(output, "ok", json_object_new_boolean(surface->ok));
  json_object_object_add(output, "code", json_object_new_string(surface->code ? surface->code : "UNKNOWN"));
  json_object_object_add(output, "pid", json_object_new_int64(surface->pid));
  json_object_object_add(output, "uid", json_object_new_int64(surface->uid));
  json_object_object_add(output, "pidStarttime",
                         json_object_new_int64((int64_t)surface->pid_starttime));
  json_object_object_add(output, "profileMatched", json_object_new_boolean(surface->profile_matched));
  json_object_object_add(output, "wmClassInstance", json_object_new_string(surface->class_instance));
  json_object_object_add(output, "wmClass", json_object_new_string(surface->class_name));
  json_object_object_add(output, "mapState",
                         json_object_new_string(surface->map_viewable ? "viewable" : "not_viewable"));
  if (surface->geometry && surface->translate && surface->tree) {
    json_object_object_add(geometry, "x", json_object_new_int(surface->translate->dst_x));
    json_object_object_add(geometry, "y", json_object_new_int(surface->translate->dst_y));
    json_object_object_add(geometry, "width", json_object_new_int(surface->geometry->width));
    json_object_object_add(geometry, "height", json_object_new_int(surface->geometry->height));
    json_object_object_add(geometry, "borderWidth", json_object_new_int(surface->geometry->border_width));
    json_object_object_add(geometry, "root", json_object_new_int64(surface->tree->root));
    json_object_object_add(geometry, "parent", json_object_new_int64(surface->tree->parent));
    json_object_object_add(geometry, "parentIsRoot",
                           json_object_new_boolean(surface->tree->parent == surface->tree->root));
  }
  json_object_object_add(output, "geometry", geometry);
  json_object_object_add(opacity, "present", json_object_new_boolean(surface->opacity_present));
  json_object_object_add(opacity, "value", json_object_new_int64(surface->opacity));
  json_object_object_add(opacity, "full", json_object_new_boolean(surface->opacity_full));
  json_object_object_add(opacity, "target",
                         surface->request.has_target_opacity
                           ? json_object_new_int64(surface->request.target_opacity)
                           : NULL);
  json_object_object_add(output, "opacity", opacity);
  add_xcb_error_json(output, surface->first_error);
  return output;
}

static json_object *base_response(const HelperState *state, const char *request_id,
                                  const char *operation) {
  json_object *response = json_object_new_object();
  bool has_active_lease = state->lease_active || state->watch_lease_id[0];
  const char *active_lease_id = state->lease_active ? state->lease_id : state->watch_lease_id;
  uint64_t active_generation = state->lease_active
    ? state->lease_generation : state->watch_lease_id[0]
      ? state->watch_generation : state->generation_floor;
  int64_t active_expires_ns = state->lease_active ? state->lease_expires_ns : state->watch_expires_ns;
  json_object_object_add(response, "version", json_object_new_int(1));
  json_object_object_add(response, "requestId", json_object_new_string(request_id ? request_id : "unknown"));
  json_object_object_add(response, "operation", json_object_new_string(operation ? operation : "unknown"));
  json_object_object_add(response, "daemonInstanceId", json_object_new_string(state->daemon_instance_id));
  json_object_object_add(response, "connectionEpoch", json_object_new_int64((int64_t)state->connection_epoch));
  json_object_object_add(response, "generation", json_object_new_int64((int64_t)active_generation));
  if (has_active_lease && active_lease_id[0]) {
    json_object_object_add(response, "leaseId", json_object_new_string(active_lease_id));
  } else {
    json_object_object_add(response, "leaseId", NULL);
  }
  json_object_object_add(response, "watchValid", json_object_new_boolean(state->watch_valid));
  json_object_object_add(response, "watchInvalidReason",
                         json_object_new_string(state->watch_invalid_reason[0]
                           ? state->watch_invalid_reason : "NOT_WATCHING"));
  json_object_object_add(response, "watchRepairScope",
                         json_object_new_string(watch_repair_scope_name(state->watch_repair_scope)));
  json_object_object_add(response, "watchRepairPending",
                         json_object_new_boolean(state->watch_repair_pending ||
                                                 state->watch_repair_in_flight));
  json_object_object_add(response, "mutationStarted", json_object_new_boolean(state->mutation_started));
  json_object_object_add(response, "leaseReleased", json_object_new_boolean(!has_active_lease));
  json_object_object_add(response, "inFlight", json_object_new_boolean(state->in_flight));
  json_object_object_add(response, "leaseExpiresMonotonicMs",
                         has_active_lease
                           ? json_object_new_int64(active_expires_ns / 1000000LL)
                           : NULL);
  json_object_object_add(response, "errorCode", NULL);
  return response;
}

static json_object *health_response(const HelperState *state, const char *request_id) {
  json_object *response = base_response(state, request_id, "health");
  json_object *counters = json_object_new_object();
  json_object *operations = json_object_new_array();
  json_object *watch_events = json_object_new_array();
  json_object *watch_surfaces = json_object_new_array();
  bool connection_ok = state->connection && xcb_connection_has_error(state->connection) == 0;
  json_object_array_add(operations, json_object_new_string("health"));
  json_object_array_add(operations, json_object_new_string("inspect"));
  if (state->phase == 1) {
    json_object_array_add(operations, json_object_new_string("screen-probe"));
    json_object_array_add(operations, json_object_new_string("switch"));
    json_object_array_add(operations, json_object_new_string("revoke"));
  } else if (state->phase == 3) {
    json_object_array_add(operations, json_object_new_string("watch"));
    json_object_array_add(operations, json_object_new_string("renew-watch"));
    json_object_array_add(operations, json_object_new_string("unwatch"));
    json_object_array_add(operations, json_object_new_string("revoke"));
  }
  json_object_object_add(response, "ok", json_object_new_boolean(connection_ok));
  json_object_object_add(response, "code",
                         json_object_new_string(connection_ok ? "OK" : "XCB_DISCONNECTED"));
  json_object_object_add(response, "phase", json_object_new_int(state->phase));
  json_object_object_add(response, "readOnly",
                         json_object_new_boolean(state->phase != 1 &&
                                                 !watch_repair_scope_has_writes(state)));
  json_object_object_add(response, "mutationsAllowed",
                         json_object_new_boolean((state->phase == 1 ||
                                                  (state->phase == 3 && state->watch_valid &&
                                                   watch_repair_scope_has_writes(state))) &&
                                                 connection_ok &&
                                                 state->generation_state == GENERATION_OK));
  json_object_object_add(response, "generationFloor", json_object_new_int64((int64_t)state->generation_floor));
  json_object_object_add(response, "generationState",
                         json_object_new_string(generation_state_name(state->generation_state)));
  json_object_object_add(response, "transactionDeadlineMs",
                         json_object_new_int(state->transaction_timeout_ms));
  json_object_object_add(response, "supportedOperations", operations);
  json_object_object_add(counters, "totalRequests", json_object_new_int64((int64_t)state->total_requests));
  json_object_object_add(counters, "inspectRequests", json_object_new_int64((int64_t)state->inspect_requests));
  json_object_object_add(counters, "inspectFailures", json_object_new_int64((int64_t)state->inspect_failures));
  json_object_object_add(counters, "guardPausedRequests",
                         json_object_new_int64((int64_t)state->guard_paused_requests));
  json_object_object_add(counters, "protocolFrameTimeouts",
                         json_object_new_int64((int64_t)state->protocol_frame_timeouts));
  json_object_object_add(counters, "switchRequests", json_object_new_int64((int64_t)state->switch_requests));
  json_object_object_add(counters, "switchFailures", json_object_new_int64((int64_t)state->switch_failures));
  json_object_object_add(counters, "mutationRequests", json_object_new_int64((int64_t)state->mutation_requests));
  json_object_object_add(counters, "revokeRequests", json_object_new_int64((int64_t)state->revoke_requests));
  json_object_object_add(counters, "xcbTimeouts", json_object_new_int64((int64_t)state->xcb_timeouts));
  json_object_object_add(counters, "reconnects", json_object_new_int64((int64_t)state->reconnects));
  json_object_object_add(counters, "watchRequests", json_object_new_int64((int64_t)state->watch_requests));
  json_object_object_add(counters, "watchRenewRequests",
                         json_object_new_int64((int64_t)state->watch_renew_requests));
  json_object_object_add(counters, "watchUnwatchRequests",
                         json_object_new_int64((int64_t)state->watch_unwatch_requests));
  json_object_object_add(counters, "watchEventsReceived",
                         json_object_new_int64((int64_t)state->watch_events_received));
  json_object_object_add(counters, "watchEventsReported",
                         json_object_new_int64((int64_t)state->watch_events_reported));
  json_object_object_add(counters, "watchEventsWouldRepair",
                         json_object_new_int64((int64_t)state->watch_events_would_repair));
  json_object_object_add(counters, "watchEventsStaleDropped",
                         json_object_new_int64((int64_t)state->watch_events_stale_dropped));
  json_object_object_add(counters, "watchEventsUnrelatedDropped",
                         json_object_new_int64((int64_t)state->watch_events_unrelated_dropped));
  json_object_object_add(counters, "watchEventsDuplicateDropped",
                         json_object_new_int64((int64_t)state->watch_events_duplicate_dropped));
  json_object_object_add(counters, "watchRepairRequests",
                         json_object_new_int64((int64_t)state->watch_repair_requests));
  json_object_object_add(counters, "watchRepairMutations",
                         json_object_new_int64((int64_t)state->watch_repair_mutations));
  json_object_object_add(counters, "watchRepairFailures",
                         json_object_new_int64((int64_t)state->watch_repair_failures));
  for (size_t offset = 0; offset < state->watch_event_history_count; offset++) {
    size_t index = state->watch_event_history_count == MAX_WATCH_EVENT_HISTORY
      ? (state->next_watch_event_slot + offset) % MAX_WATCH_EVENT_HISTORY : offset;
    const WatchEvent *event = &state->watch_event_history[index];
    json_object *entry = json_object_new_object();
    json_object_object_add(entry, "sequence", json_object_new_int(event->sequence));
    json_object_object_add(entry, "type", json_object_new_string(event->type));
    json_object_object_add(entry, "role", json_object_new_string(event->role));
    json_object_object_add(entry, "xid", json_object_new_int64(event->xid));
    json_object_object_add(entry, "property", event->property
                           ? json_object_new_int64(event->property) : NULL);
    json_object_object_add(entry, "rootForwarded", json_object_new_boolean(event->root_forwarded));
    json_object_object_add(entry, "wouldRepair", json_object_new_boolean(event->would_repair));
    json_object_array_add(watch_events, entry);
  }
  json_object_object_add(response, "watchEvents", watch_events);
  for (size_t index = 0; index < state->watch_surface_count; index++) {
    json_object *surface = json_object_new_object();
    json_object_object_add(surface, "role", json_object_new_string(state->watch_roles[index]));
    json_object_object_add(surface, "xid", json_object_new_int64(state->watch_surfaces[index]));
    json_object_array_add(watch_surfaces, surface);
  }
  json_object_object_add(response, "watchSurfaces", watch_surfaces);
  json_object_object_add(response, "counters", counters);
  return response;
}

static bool get_required_string(json_object *object, const char *key, const char **output) {
  json_object *value = NULL;
  if (!json_object_object_get_ex(object, key, &value) || !json_object_is_type(value, json_type_string)) {
    return false;
  }
  *output = json_object_get_string(value);
  return *output && (*output)[0];
}

static bool request_has_caller_role(json_object *request, const char *role) {
  json_object *value = NULL;
  return json_object_object_get_ex(request, "callerRole", &value) &&
         json_object_is_type(value, json_type_string) &&
         strcmp(json_object_get_string(value), role) == 0;
}

static json_object *error_response(const HelperState *state, const char *request_id,
                                   const char *operation, const char *code) {
  json_object *response = base_response(state, request_id, operation);
  json_object_object_add(response, "ok", json_object_new_boolean(false));
  json_object_object_add(response, "code", json_object_new_string(code));
  json_object_object_add(response, "errorCode", json_object_new_string(code));
  json_object_object_add(response, "fallbackRecommended", json_object_new_boolean(false));
  return response;
}

static const char *collect_error_code(int result) {
  switch (result) {
    case COLLECT_REPLY_TIMEOUT: return "X11_REPLY_TIMEOUT";
    case COLLECT_XCB_CONNECTION_ERROR: return "XCB_CONNECTION_ERROR";
    case COLLECT_POLL_ERROR: return "XCB_POLL_ERROR";
    case COLLECT_INTERRUPTED: return "HELPER_STOPPING";
  }
  return "XCB_COLLECTION_FAILED";
}

static bool image_reply_range(const xcb_get_image_reply_t *reply, uint16_t width,
                              uint16_t height, int *range_output) {
  const uint8_t *pixels;
  size_t pixel_count;
  size_t byte_count;
  size_t bytes_per_pixel;
  uint8_t minimum = UINT8_MAX;
  uint8_t maximum = 0;
  if (!reply || width == 0 || height == 0) return false;
  pixel_count = (size_t)width * (size_t)height;
  byte_count = (size_t)xcb_get_image_data_length(reply);
  if (pixel_count == 0 || byte_count == 0 || byte_count % pixel_count != 0) return false;
  bytes_per_pixel = byte_count / pixel_count;
  /* The kiosk root is 24-bit RGB in a 32-bit X11 pixel.  Support tightly
   * packed RGB too, but reject unexpected encodings rather than treating an
   * alpha/filler byte as visible content. */
  if (bytes_per_pixel < 3 || bytes_per_pixel > 8) return false;
  pixels = xcb_get_image_data(reply);
  if (!pixels) return false;
  for (size_t pixel = 0; pixel < pixel_count; pixel++) {
    const uint8_t *channels = pixels + pixel * bytes_per_pixel;
    for (size_t channel = 0; channel < 3; channel++) {
      if (channels[channel] < minimum) minimum = channels[channel];
      if (channels[channel] > maximum) maximum = channels[channel];
    }
  }
  *range_output = (int)maximum - (int)minimum;
  return true;
}

static json_object *screen_probe_response(HelperState *state, const char *request_id,
                                          int64_t received_ns) {
  const uint16_t provider_width = 1920;
  const uint16_t panel_width = 640;
  const uint16_t height = 720;
  const int64_t deadline_ns = received_ns +
    (int64_t)state->transaction_timeout_ms * 1000000LL;
  xcb_get_image_cookie_t provider_cookie;
  xcb_get_image_cookie_t panel_cookie;
  xcb_get_image_reply_t *provider_reply = NULL;
  xcb_get_image_reply_t *panel_reply = NULL;
  xcb_generic_error_t *provider_error = NULL;
  xcb_generic_error_t *panel_error = NULL;
  CollectResult result;
  int provider_range = 0;
  int panel_range = 0;
  const char *code = "OK";
  bool ok = false;
  json_object *response;

  if (state->phase != 1) return error_response(state, request_id, "screen-probe",
                                                "OPERATION_DISABLED_PHASE0");
  if (!state->connection || !state->screen || state->screen->width_in_pixels < provider_width + panel_width ||
      state->screen->height_in_pixels < height) {
    return error_response(state, request_id, "screen-probe", "SCREEN_UNAVAILABLE");
  }
  provider_cookie = xcb_get_image(state->connection, XCB_IMAGE_FORMAT_Z_PIXMAP,
                                  state->screen->root, 0, 0, provider_width, height,
                                  UINT32_MAX);
  panel_cookie = xcb_get_image(state->connection, XCB_IMAGE_FORMAT_Z_PIXMAP,
                               state->screen->root, provider_width, 0, panel_width, height,
                               UINT32_MAX);
  if (xcb_flush(state->connection) <= 0) {
    code = "XCB_CONNECTION_ERROR";
  } else {
    result = collect_single_reply(state, provider_cookie.sequence, deadline_ns,
                                  (void **)&provider_reply, &provider_error);
    if (result == COLLECT_OK) {
      result = collect_single_reply(state, panel_cookie.sequence, deadline_ns,
                                    (void **)&panel_reply, &panel_error);
    }
    if (result != COLLECT_OK) {
      code = result == SURFACE_QUERY_FAILED ? "SCREEN_PROBE_FAILED" : collect_error_code(result);
    } else if (!image_reply_range(provider_reply, provider_width, height, &provider_range) ||
               !image_reply_range(panel_reply, panel_width, height, &panel_range)) {
      code = "SCREEN_PROBE_FORMAT_UNSUPPORTED";
    } else if (provider_range < 12 || panel_range < 12) {
      code = "SCREEN_REGIONS_BLANK";
    } else {
      ok = true;
    }
  }
  free(provider_reply);
  free(panel_reply);
  free(provider_error);
  free(panel_error);
  if (!ok && (strcmp(code, "X11_REPLY_TIMEOUT") == 0 ||
              strcmp(code, "XCB_CONNECTION_ERROR") == 0 ||
              strcmp(code, "XCB_POLL_ERROR") == 0)) {
    if (strcmp(code, "X11_REPLY_TIMEOUT") == 0) state->xcb_timeouts++;
    reset_xcb_connection(state);
  }
  response = base_response(state, request_id, "screen-probe");
  json_object_object_add(response, "ok", json_object_new_boolean(ok));
  json_object_object_add(response, "code", json_object_new_string(code));
  json_object_object_add(response, "errorCode", ok ? NULL : json_object_new_string(code));
  json_object_object_add(response, "providerRange", json_object_new_int(provider_range));
  json_object_object_add(response, "panelRange", json_object_new_int(panel_range));
  return response;
}

static bool collect_requires_connection_reset(int result) {
  return result == COLLECT_REPLY_TIMEOUT || result == COLLECT_XCB_CONNECTION_ERROR ||
         result == COLLECT_POLL_ERROR;
}

static const char *pending_kind_name(PendingKind kind) {
  switch (kind) {
    case PENDING_GEOMETRY: return "geometry";
    case PENDING_TRANSLATE: return "translate";
    case PENDING_ATTRIBUTES: return "attributes";
    case PENDING_PID: return "pid";
    case PENDING_CLASS: return "class";
    case PENDING_OPACITY: return "opacity";
    case PENDING_TREE: return "tree";
  }
  return "unknown";
}

static void add_collector_diagnostics(json_object *response,
                                      const CollectorDiagnostics *diagnostics) {
  json_object *value;
  json_object *entries;
  if (!response || !diagnostics || diagnostics->result == COLLECT_OK) return;
  value = json_object_new_object();
  entries = json_object_new_array();
  json_object_object_add(value, "result", json_object_new_string(collect_error_code(diagnostics->result)));
  json_object_object_add(value, "xcbConnectionError",
                         json_object_new_int(diagnostics->connection_error));
  json_object_object_add(value, "pollErrno", json_object_new_int(diagnostics->poll_errno));
  json_object_object_add(value, "pollRevents", json_object_new_int(diagnostics->poll_revents));
  json_object_object_add(value, "pendingCount", json_object_new_int64((int64_t)diagnostics->pending_count));
  json_object_object_add(value, "completedCount", json_object_new_int64((int64_t)diagnostics->completed_count));
  json_object_object_add(value, "finalScan", json_object_new_boolean(diagnostics->final_scan));
  json_object_object_add(value, "finalScanProgressed",
                         json_object_new_boolean(diagnostics->final_scan_progressed));
  json_object_object_add(value, "stopRequested", json_object_new_boolean(diagnostics->stop_requested));
  for (size_t index = 0; index < diagnostics->pending_diagnostic_count; index++) {
    json_object *entry = json_object_new_object();
    json_object_object_add(entry, "sequence",
                           json_object_new_int64((int64_t)diagnostics->pending[index].sequence));
    json_object_object_add(entry, "kind",
                           json_object_new_string(pending_kind_name(diagnostics->pending[index].kind)));
    json_object_object_add(entry, "surfaceIndex",
                           json_object_new_int64((int64_t)diagnostics->pending[index].surface_index));
    json_object_object_add(entry, "done", json_object_new_boolean(diagnostics->pending[index].done));
    json_object_object_add(entry, "replyReady",
                           json_object_new_boolean(diagnostics->pending[index].reply_ready));
    json_object_object_add(entry, "errorReady",
                           json_object_new_boolean(diagnostics->pending[index].error_ready));
    json_object_array_add(entries, entry);
  }
  json_object_object_add(value, "pending", entries);
  json_object_object_add(response, "collectorDiagnostics", value);
}

static bool get_required_int64(json_object *object, const char *key, int64_t *output) {
  json_object *value = NULL;
  if (!json_object_object_get_ex(object, key, &value) ||
      !json_object_is_type(value, json_type_int)) {
    return false;
  }
  *output = json_object_get_int64(value);
  return true;
}

static void copy_json_field(json_object *target, const char *target_key,
                            json_object *source, const char *source_key) {
  json_object *value = NULL;
  if (source && json_object_object_get_ex(source, source_key, &value)) {
    json_object_object_add(target, target_key, json_object_get(value));
  } else {
    json_object_object_add(target, target_key, NULL);
  }
}

static void add_request_surface_xids(json_object *log_entry, json_object *request) {
  json_object *surfaces = NULL;
  json_object *surface_xids = json_object_new_object();
  if (json_object_object_get_ex(request, "surfaces", &surfaces) &&
      json_object_is_type(surfaces, json_type_array)) {
    size_t count = json_object_array_length(surfaces);
    for (size_t index = 0; index < count; index++) {
      json_object *surface = json_object_array_get_idx(surfaces, index);
      json_object *role = NULL;
      json_object *xid = NULL;
      if (!surface || !json_object_is_type(surface, json_type_object) ||
          !json_object_object_get_ex(surface, "role", &role) ||
          !json_object_is_type(role, json_type_string) ||
          !json_object_object_get_ex(surface, "xid", &xid) ||
          !json_object_is_type(xid, json_type_int)) {
        continue;
      }
      json_object_object_add(surface_xids, json_object_get_string(role), json_object_get(xid));
    }
  }
  json_object_object_add(log_entry, "surfaceXids", surface_xids);
}

static json_object *parse_request_for_log(const char *packet, size_t packet_length) {
  json_tokener *tokener = json_tokener_new_ex(32);
  json_object *request = NULL;
  if (tokener) request = json_tokener_parse_ex(tokener, packet, (int)packet_length);
  if (!request || !json_object_is_type(request, json_type_object)) {
    if (request) json_object_put(request);
    request = json_object_new_object();
  }
  if (tokener) json_tokener_free(tokener);
  return request;
}

static json_object *new_request_log_entry(const HelperState *state, json_object *request,
                                          const char *event, int64_t event_ns,
                                          uint64_t epoch_before) {
  json_object *entry = json_object_new_object();
  json_object *value = NULL;
  if (!entry) return NULL;
  json_object_object_add(entry, "event", json_object_new_string(event));
  json_object_object_add(entry, "monotonicNs", json_object_new_int64(event_ns));
  copy_json_field(entry, "requestId", request, "requestId");
  copy_json_field(entry, "operation", request, "operation");
  copy_json_field(entry, "callerPid", request, "callerPid");
  copy_json_field(entry, "callerRole", request, "callerRole");
  if (json_object_object_get_ex(request, "generation", &value)) {
    json_object_object_add(entry, "generation", json_object_get(value));
  } else {
    json_object_object_add(entry, "generation", NULL);
  }
  add_request_surface_xids(entry, request);
  json_object_object_add(entry, "daemonInstanceId",
                         json_object_new_string(state->daemon_instance_id));
  json_object_object_add(entry, "connectionEpochBefore",
                         json_object_new_int64((int64_t)epoch_before));
  json_object_object_add(entry, "connectionEpoch",
                         json_object_new_int64((int64_t)state->connection_epoch));
  return entry;
}

static void emit_request_log(json_object *entry) {
  if (!entry) return;
  (void)fprintf(stderr, "%s\n",
                json_object_to_json_string_ext(entry, JSON_C_TO_STRING_PLAIN));
  (void)fflush(stderr);
  json_object_put(entry);
}

static void log_request_started(const HelperState *state, const char *packet,
                                size_t packet_length, int64_t received_ns,
                                uint64_t epoch_before) {
  json_object *request = parse_request_for_log(packet, packet_length);
  json_object *entry = new_request_log_entry(state, request, "request_started",
                                             received_ns, epoch_before);
  if (entry) {
    json_object_object_add(entry, "receivedMonotonicNs", json_object_new_int64(received_ns));
    json_object_object_add(entry, "inFlight", json_object_new_boolean(state->in_flight));
  }
  emit_request_log(entry);
  json_object_put(request);
}

static void log_request_result(const HelperState *state, const char *packet, size_t packet_length,
                               json_object *response, int64_t received_ns, int64_t completed_ns,
                               uint64_t epoch_before, uint64_t timeouts_before,
                               uint64_t reconnects_before) {
  json_object *request = parse_request_for_log(packet, packet_length);
  json_object *timings = NULL;
  json_object *value = NULL;
  json_object *entry = NULL;
  const char *code = "unknown";
  uint64_t timeout_delta = state->xcb_timeouts - timeouts_before;
  uint64_t reconnect_delta = state->reconnects - reconnects_before;
  uint64_t epoch_delta = state->connection_epoch - epoch_before;
  bool reset = epoch_delta > reconnect_delta;
  bool ok = false;
  if (response && json_object_object_get_ex(response, "code", &value) &&
      json_object_is_type(value, json_type_string)) {
    code = json_object_get_string(value);
  }
  if (response && json_object_object_get_ex(response, "ok", &value) &&
      json_object_is_type(value, json_type_boolean)) {
    ok = json_object_get_boolean(value);
  }
  if (response) json_object_object_get_ex(response, "timings", &timings);

  if (timeout_delta > 0 || strcmp(code, "X11_REPLY_TIMEOUT") == 0) {
    entry = new_request_log_entry(state, request, "x11_reply_timeout",
                                  completed_ns, epoch_before);
    if (entry) {
      json_object_object_add(entry, "code", json_object_new_string("X11_REPLY_TIMEOUT"));
      json_object_object_add(entry, "timeout", json_object_new_boolean(true));
      copy_json_field(entry, "collectorDiagnostics", response, "collectorDiagnostics");
      if (timings && json_object_is_type(timings, json_type_object)) {
        copy_json_field(entry, "replyWaitMs", timings, "replyWaitMs");
      }
    }
    emit_request_log(entry);
  }
  if (reset) {
    entry = new_request_log_entry(state, request, "connection_reset",
                                  completed_ns, epoch_before);
    if (entry) {
      json_object_object_add(entry, "result", json_object_new_string("disconnected"));
      copy_json_field(entry, "leaseReleased", response, "leaseReleased");
      copy_json_field(entry, "inFlight", response, "inFlight");
    }
    emit_request_log(entry);
  }
  if (reconnect_delta > 0) {
    entry = new_request_log_entry(state, request, "reconnect", completed_ns, epoch_before);
    if (entry) {
      json_object_object_add(entry, "result",
                             json_object_new_string(state->connection ? "connected" : "failed"));
    }
    emit_request_log(entry);
  }

  entry = new_request_log_entry(state, request,
                                ok ? "request_completed" : "request_failed",
                                completed_ns, epoch_before);
  if (!entry) {
    json_object_put(request);
    return;
  }
  json_object_object_add(entry, "receivedMonotonicNs", json_object_new_int64(received_ns));
  if (!json_object_object_get_ex(request, "generation", &value)) {
    json_object_object_del(entry, "generation");
    copy_json_field(entry, "generation", response, "generation");
  }
  json_object_object_add(entry, "queueMs", NULL);
  json_object_object_add(entry, "batchSendMs", NULL);
  json_object_object_add(entry, "batchReadMs", NULL);
  json_object_object_add(entry, "replyWaitMs", NULL);
  if (timings && json_object_is_type(timings, json_type_object)) {
    copy_json_field(entry, "queueMs", timings, "daemonQueueMs");
    copy_json_field(entry, "batchSendMs", timings, "batchSendMs");
    copy_json_field(entry, "batchReadMs", timings, "batchReadMs");
    copy_json_field(entry, "replyWaitMs", timings, "replyWaitMs");
  }
  json_object_object_add(entry, "totalMs", duration_ms_json(received_ns, completed_ns));
  json_object_object_add(entry, "result", json_object_new_string(ok ? "ok" : "failed"));
  json_object_object_add(entry, "code", json_object_new_string(code));
  copy_json_field(entry, "errorCode", response, "errorCode");
  copy_json_field(entry, "collectorDiagnostics", response, "collectorDiagnostics");
  copy_json_field(entry, "leaseReleased", response, "leaseReleased");
  copy_json_field(entry, "inFlight", response, "inFlight");
  copy_json_field(entry, "mutationStarted", response, "mutationStarted");
  json_object_object_add(entry, "timeout", json_object_new_boolean(timeout_delta > 0));
  json_object_object_add(entry, "connectionReset", json_object_new_boolean(reset));
  json_object_object_add(entry, "resetResult",
                         json_object_new_string(reset ? "disconnected" : "not_needed"));
  json_object_object_add(entry, "reconnectResult",
                         json_object_new_string(reconnect_delta > 0
                           ? (state->connection ? "connected" : "failed")
                           : (reset ? "deferred" : "not_needed")));
  json_object_object_add(entry, "connectionAvailable",
                         json_object_new_boolean(state->connection != NULL));
  emit_request_log(entry);
  json_object_put(request);
}

static bool parse_target_geometry(json_object *surface, SurfaceRequest *request) {
  json_object *geometry = NULL;
  int64_t x;
  int64_t y;
  int64_t width;
  int64_t height;
  if (!json_object_object_get_ex(surface, "geometry", &geometry) ||
      !json_object_is_type(geometry, json_type_object) ||
      !get_required_int64(geometry, "x", &x) || !get_required_int64(geometry, "y", &y) ||
      !get_required_int64(geometry, "width", &width) ||
      !get_required_int64(geometry, "height", &height) ||
      x < INT32_MIN || x > INT32_MAX || y < INT32_MIN || y > INT32_MAX ||
      width <= 0 || width > UINT16_MAX || height <= 0 || height > UINT16_MAX ||
      (uint64_t)width * (uint64_t)height <= 100000) {
    return false;
  }
  request->target_x = (int32_t)x;
  request->target_y = (int32_t)y;
  request->target_width = (uint32_t)width;
  request->target_height = (uint32_t)height;
  request->has_target_geometry = true;
  return true;
}

static bool parse_target_opacity(json_object *surface, SurfaceRequest *request) {
  json_object *value = NULL;
  int64_t opacity;
  if (!json_object_object_get_ex(surface, "targetOpacity", &value)) return true;
  if (!json_object_is_type(value, json_type_int)) return false;
  opacity = json_object_get_int64(value);
  if (opacity < 0 || (uint64_t)opacity > UINT32_MAX) return false;
  request->has_target_opacity = true;
  request->target_opacity = (uint32_t)opacity;
  return true;
}

static bool parse_switch_surfaces(json_object *request, SurfaceResult surfaces[3]) {
  json_object *values = NULL;
  bool target_seen = false;
  bool previous_seen = false;
  bool panel_seen = false;
  bool target_opacity_seen = false;
  bool panel_opacity_seen = false;
  if (!json_object_object_get_ex(request, "surfaces", &values) ||
      !json_object_is_type(values, json_type_array) || json_object_array_length(values) != 3) {
    return false;
  }
  for (size_t index = 0; index < 3; index++) {
    json_object *surface = json_object_array_get_idx(values, index);
    json_object *xid_value = NULL;
    const char *role;
    const char *profile;
    int64_t xid;
    if (!surface || !json_object_is_type(surface, json_type_object) ||
        !get_required_string(surface, "role", &role) || strlen(role) >= MAX_ROLE ||
        !get_required_string(surface, "profile", &profile) || strlen(profile) >= PATH_MAX ||
        !json_object_object_get_ex(surface, "xid", &xid_value) ||
        !json_object_is_type(xid_value, json_type_int)) {
      return false;
    }
    xid = json_object_get_int64(xid_value);
    if (xid <= 0 || xid > UINT32_MAX) return false;
    if (strcmp(role, "target") == 0 && !target_seen) target_seen = true;
    else if (strcmp(role, "previous") == 0 && !previous_seen) previous_seen = true;
    else if (strcmp(role, "panel") == 0 && !panel_seen) panel_seen = true;
    else return false;
    snprintf(surfaces[index].request.role, sizeof(surfaces[index].request.role), "%s", role);
    snprintf(surfaces[index].request.profile, sizeof(surfaces[index].request.profile), "%s", profile);
    surfaces[index].request.xid = (xcb_window_t)xid;
    if (!parse_target_geometry(surface, &surfaces[index].request) ||
        !parse_target_opacity(surface, &surfaces[index].request)) return false;
    if (strcmp(role, "target") == 0) {
      target_opacity_seen = surfaces[index].request.has_target_opacity;
    } else if (strcmp(role, "panel") == 0) {
      panel_opacity_seen = surfaces[index].request.has_target_opacity;
    }
  }
  if (!target_seen || !previous_seen || !panel_seen) return false;
  return target_opacity_seen && panel_opacity_seen &&
         surfaces[0].request.xid != surfaces[1].request.xid &&
         surfaces[0].request.xid != surfaces[2].request.xid &&
         surfaces[1].request.xid != surfaces[2].request.xid;
}

static SurfaceResult *surface_for_role(SurfaceResult *surfaces, size_t count, const char *role) {
  for (size_t index = 0; index < count; index++) {
    if (strcmp(surfaces[index].request.role, role) == 0) return &surfaces[index];
  }
  return NULL;
}

static bool surface_at_target_geometry(const SurfaceResult *surface) {
  return surface->geometry && surface->translate &&
         surface->translate->dst_x == surface->request.target_x &&
         surface->translate->dst_y == surface->request.target_y &&
         surface->geometry->width == surface->request.target_width &&
         surface->geometry->height == surface->request.target_height;
}

static bool surface_at_target_opacity(const SurfaceResult *surface) {
  uint32_t effective_opacity = surface->opacity_present ? surface->opacity : UINT32_MAX;
  return !surface->request.has_target_opacity || effective_opacity == surface->request.target_opacity;
}

static bool configure_coordinates(const SurfaceResult *surface, int32_t *x, int32_t *y) {
  int64_t parent_root_x;
  int64_t parent_root_y;
  int64_t configure_x;
  int64_t configure_y;
  if (!surface->geometry || !surface->translate || !surface->tree ||
      surface->tree->parent == XCB_WINDOW_NONE) {
    return false;
  }
  parent_root_x = (int64_t)surface->translate->dst_x - surface->geometry->x -
                  surface->geometry->border_width;
  parent_root_y = (int64_t)surface->translate->dst_y - surface->geometry->y -
                  surface->geometry->border_width;
  configure_x = (int64_t)surface->request.target_x - parent_root_x -
                surface->geometry->border_width;
  configure_y = (int64_t)surface->request.target_y - parent_root_y -
                surface->geometry->border_width;
  if (configure_x < INT32_MIN || configure_x > INT32_MAX ||
      configure_y < INT32_MIN || configure_y > INT32_MAX) {
    return false;
  }
  *x = (int32_t)configure_x;
  *y = (int32_t)configure_y;
  return true;
}

static void add_checked_mutation(CheckedMutation mutations[MAX_MUTATIONS], size_t *count,
                                 xcb_void_cookie_t cookie, const char *action, xcb_window_t xid) {
  CheckedMutation *mutation = &mutations[(*count)++];
  mutation->sequence = cookie.sequence;
  mutation->xid = xid;
  snprintf(mutation->action, sizeof(mutation->action), "%s", action);
}

static bool queue_geometry_mutation(HelperState *state, const SurfaceResult *surface,
                                    bool stack_above, CheckedMutation mutations[MAX_MUTATIONS],
                                    size_t *mutation_count, const char *action) {
  uint16_t mask = XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y |
                  XCB_CONFIG_WINDOW_WIDTH | XCB_CONFIG_WINDOW_HEIGHT;
  uint32_t values[5];
  int32_t x;
  int32_t y;
  if (!configure_coordinates(surface, &x, &y)) return false;
  values[0] = (uint32_t)x;
  values[1] = (uint32_t)y;
  values[2] = surface->request.target_width;
  values[3] = surface->request.target_height;
  if (stack_above) {
    mask |= XCB_CONFIG_WINDOW_STACK_MODE;
    values[4] = XCB_STACK_MODE_ABOVE;
  }
  add_checked_mutation(mutations, mutation_count,
    xcb_configure_window_checked(state->connection, surface->request.xid, mask, values),
    action, surface->request.xid);
  return true;
}

static void queue_raise_mutation(HelperState *state, const SurfaceResult *surface,
                                 CheckedMutation mutations[MAX_MUTATIONS], size_t *mutation_count,
                                 const char *action) {
  uint32_t value = XCB_STACK_MODE_ABOVE;
  add_checked_mutation(mutations, mutation_count,
    xcb_configure_window_checked(state->connection, surface->request.xid,
                                 XCB_CONFIG_WINDOW_STACK_MODE, &value),
    action, surface->request.xid);
}

static void queue_opacity_mutation(HelperState *state, const SurfaceResult *surface,
                                   CheckedMutation mutations[MAX_MUTATIONS], size_t *mutation_count,
                                   const char *action) {
  uint32_t value = surface->request.target_opacity;
  add_checked_mutation(mutations, mutation_count,
    xcb_change_property_checked(state->connection, XCB_PROP_MODE_REPLACE,
                                surface->request.xid, state->net_wm_opacity,
                                XCB_ATOM_CARDINAL, 32, 1, &value),
    action, surface->request.xid);
}

static int collect_checked_mutations(HelperState *state,
                                     CheckedMutation mutations[MAX_MUTATIONS], size_t count) {
  int result = 0;
  for (size_t index = 0; index < count; index++) {
    void *reply = NULL;
    xcb_generic_error_t *error = NULL;
    int ready;
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
    if (self_test_checked_not_ready && index == 0) {
      ready = 0;
    } else
#endif
    {
      ready = xcb_poll_for_reply(state->connection, mutations[index].sequence, &reply, &error);
    }
    free(reply);
    mutations[index].done = ready != 0;
    mutations[index].error = error;
    if (!ready) result = -1;
    else if (error) result = -2;
  }
  return result;
}

static void free_checked_mutations(CheckedMutation mutations[MAX_MUTATIONS], size_t count) {
  for (size_t index = 0; index < count; index++) free(mutations[index].error);
}

static json_object *checked_mutations_to_json(const CheckedMutation mutations[MAX_MUTATIONS],
                                              size_t count) {
  json_object *array = json_object_new_array();
  for (size_t index = 0; index < count; index++) {
    json_object *value = json_object_new_object();
    json_object_object_add(value, "action", json_object_new_string(mutations[index].action));
    json_object_object_add(value, "xid", json_object_new_int64(mutations[index].xid));
    json_object_object_add(value, "sequence", json_object_new_int64(mutations[index].sequence));
    json_object_object_add(value, "checked", json_object_new_boolean(mutations[index].done));
    json_object_object_add(value, "ok",
                           json_object_new_boolean(mutations[index].done && !mutations[index].error));
    add_xcb_error_json(value, mutations[index].error);
    json_object_array_add(array, value);
  }
  return array;
}

static int watch_snapshot_surfaces(HelperState *state, SurfaceResult *surfaces,
                                   size_t surface_count, xcb_query_tree_reply_t **root_tree,
                                   int64_t deadline_ns) {
  PendingReply pending[MAX_PENDING] = {0};
  PendingReply root_pending = {0};
  AsyncError async_error = {0};
  size_t pending_count;
  int result;
  *root_tree = NULL;
  pending_count = queue_surface_queries(state, surfaces, surface_count, pending);
  root_pending.sequence = xcb_query_tree(state->connection, state->screen->root).sequence;
  if (xcb_flush(state->connection) <= 0) {
    free_pending(pending, pending_count);
    return COLLECT_XCB_CONNECTION_ERROR;
  }
  result = finish_surface_queries(state, surfaces, surface_count, pending, pending_count,
                                  deadline_ns, &async_error, true);
  if (result == COLLECT_OK) {
    result = collect_replies(state, &root_pending, 1, deadline_ns, &async_error);
  }
  if (result == COLLECT_OK && (!root_pending.reply || root_pending.error || async_error.seen)) {
    result = SURFACE_QUERY_FAILED;
  }
  if (result == COLLECT_OK) {
    *root_tree = root_pending.reply;
    root_pending.reply = NULL;
  }
  free_pending(&root_pending, 1);
  return result;
}

static int watch_root_stack_index(const xcb_query_tree_reply_t *root_tree, xcb_window_t xid) {
  xcb_window_t *children;
  int child_count;
  if (!root_tree || xid == XCB_WINDOW_NONE) return -1;
  children = xcb_query_tree_children(root_tree);
  child_count = xcb_query_tree_children_length(root_tree);
  for (int index = 0; index < child_count; index++) {
    if (children[index] == xid) return index;
  }
  return -1;
}

static bool watch_panel_stack_mismatch(const xcb_query_tree_reply_t *root_tree,
                                       const SurfaceResult *panel) {
  int panel_index = watch_root_stack_index(root_tree, panel->request.xid);
  int child_count = root_tree ? xcb_query_tree_children_length(root_tree) : 0;
  return panel_index >= 0 && panel_index + 1 < child_count;
}

static bool watch_provider_stack_mismatch(const xcb_query_tree_reply_t *root_tree,
                                          const SurfaceResult *previous,
                                          const SurfaceResult *active,
                                          const SurfaceResult *panel) {
  int previous_index = watch_root_stack_index(root_tree, previous->request.xid);
  int active_index = watch_root_stack_index(root_tree, active->request.xid);
  int panel_index = watch_root_stack_index(root_tree, panel->request.xid);
  if (previous_index < 0 || active_index < 0 || panel_index < 0) return false;
  return !(previous_index < active_index && active_index < panel_index);
}

static bool watch_repair_final_state(const HelperState *state,
                                     const SurfaceResult *surfaces, size_t count,
                                     const xcb_query_tree_reply_t *root_tree) {
  for (size_t index = 0; index < count; index++) {
    const SurfaceResult *surface = &surfaces[index];
    if (!surface->ok || !surface_at_target_geometry(surface) ||
        !surface_at_target_opacity(surface)) return false;
  }
  if (state->watch_repair_scope == WATCH_REPAIR_PANEL) {
    return count == 1 && !watch_panel_stack_mismatch(root_tree, &surfaces[0]);
  }
  if (count != 3) return false;
  SurfaceResult *active = surface_for_role((SurfaceResult *)surfaces, count, "active");
  SurfaceResult *previous = surface_for_role((SurfaceResult *)surfaces, count, "previous");
  SurfaceResult *panel = surface_for_role((SurfaceResult *)surfaces, count, "panel");
  return active && previous && panel &&
         !watch_provider_stack_mismatch(root_tree, previous, active, panel);
}

static void repair_watched_surfaces(HelperState *state) {
  SurfaceResult surfaces[MAX_SURFACES] = {0};
  CheckedMutation mutations[MAX_MUTATIONS] = {0};
  xcb_query_tree_reply_t *root_tree = NULL;
  SurfaceResult *active = NULL;
  SurfaceResult *previous = NULL;
  SurfaceResult *panel = NULL;
  size_t mutation_count = 0;
  int result;
  int64_t deadline_ns;
  bool stack_mismatch = false;

  if (!state->watch_repair_pending || !state->watch_valid ||
      !watch_repair_scope_has_writes(state) || state->in_flight ||
      state->watch_repair_in_flight || !state->connection || !state->screen) {
    return;
  }
  state->watch_repair_pending = false;
  state->watch_repair_in_flight = true;
  state->watch_repair_requests++;
  deadline_ns = monotonic_ns() + (int64_t)state->transaction_timeout_ms * 1000000LL;
  for (size_t index = 0; index < state->watch_surface_count; index++) {
    surfaces[index].request = state->watch_targets[index];
  }
  result = watch_snapshot_surfaces(state, surfaces, state->watch_surface_count, &root_tree,
                                   deadline_ns);
  if (result != COLLECT_OK) {
    if (result == COLLECT_REPLY_TIMEOUT) state->xcb_timeouts++;
    if (collect_requires_connection_reset(result)) reset_xcb_connection(state);
    invalidate_watch(state, result == SURFACE_QUERY_DEADLINE_EXCEEDED
                     ? "WATCH_REPAIR_DEADLINE_EXCEEDED" : "WATCH_REPAIR_INSPECTION_FAILED");
    state->watch_repair_failures++;
    goto completed;
  }

  if (state->watch_repair_scope == WATCH_REPAIR_PANEL) {
    panel = &surfaces[0];
    if (strcmp(panel->request.role, "panel") != 0) {
      invalidate_watch(state, "WATCH_REPAIR_ROLE_MISMATCH");
      state->watch_repair_failures++;
      goto completed;
    }
    if (!surface_at_target_geometry(panel) &&
        !queue_geometry_mutation(state, panel, false, mutations, &mutation_count,
                                 "panel_geometry")) {
      invalidate_watch(state, "WATCH_REPAIR_PARENT_MISMATCH");
      state->watch_repair_failures++;
      goto completed;
    }
    if (!surface_at_target_opacity(panel)) {
      queue_opacity_mutation(state, panel, mutations, &mutation_count, "panel_opacity");
    }
    stack_mismatch = watch_panel_stack_mismatch(root_tree, panel);
    if (stack_mismatch) {
      queue_raise_mutation(state, panel, mutations, &mutation_count, "panel_raise");
    }
  } else {
    active = surface_for_role(surfaces, state->watch_surface_count, "active");
    previous = surface_for_role(surfaces, state->watch_surface_count, "previous");
    panel = surface_for_role(surfaces, state->watch_surface_count, "panel");
    if (!active || !previous || !panel) {
      invalidate_watch(state, "WATCH_REPAIR_ROLE_MISMATCH");
      state->watch_repair_failures++;
      goto completed;
    }
    if (!surface_at_target_geometry(previous) &&
        !queue_geometry_mutation(state, previous, false, mutations, &mutation_count,
                                 "previous_geometry")) {
      invalidate_watch(state, "WATCH_REPAIR_PARENT_MISMATCH");
      state->watch_repair_failures++;
      goto completed;
    }
    if (!surface_at_target_opacity(active)) {
      queue_opacity_mutation(state, active, mutations, &mutation_count, "active_opacity");
    }
    if (!surface_at_target_geometry(active) &&
        !queue_geometry_mutation(state, active, false, mutations, &mutation_count,
                                 "active_geometry")) {
      invalidate_watch(state, "WATCH_REPAIR_PARENT_MISMATCH");
      state->watch_repair_failures++;
      goto completed;
    }
    if (!surface_at_target_geometry(panel) &&
        !queue_geometry_mutation(state, panel, false, mutations, &mutation_count,
                                 "panel_geometry")) {
      invalidate_watch(state, "WATCH_REPAIR_PARENT_MISMATCH");
      state->watch_repair_failures++;
      goto completed;
    }
    if (!surface_at_target_opacity(panel)) {
      queue_opacity_mutation(state, panel, mutations, &mutation_count, "panel_opacity");
    }
    stack_mismatch = watch_provider_stack_mismatch(root_tree, previous, active, panel);
    if (stack_mismatch) {
      queue_raise_mutation(state, active, mutations, &mutation_count, "active_raise");
      queue_raise_mutation(state, panel, mutations, &mutation_count, "panel_raise");
    }
  }
  if (mutation_count == 0) goto completed;

  state->mutation_started = true;
  state->mutation_requests++;
  xcb_get_input_focus_cookie_t fence = xcb_get_input_focus(state->connection);
  if (xcb_flush(state->connection) <= 0) {
    invalidate_watch(state, "WATCH_REPAIR_XCB_DISCONNECTED");
    state->watch_repair_failures++;
    reset_xcb_connection(state);
    goto completed;
  }
  PendingReply fence_pending = {.sequence = fence.sequence};
  AsyncError mutation_async_error = {0};
  result = collect_replies(state, &fence_pending, 1, deadline_ns, &mutation_async_error);
  if (result != COLLECT_OK || fence_pending.error || !fence_pending.reply ||
      mutation_async_error.seen || collect_checked_mutations(state, mutations, mutation_count) != 0) {
    if (result == COLLECT_REPLY_TIMEOUT) state->xcb_timeouts++;
    if (collect_requires_connection_reset(result) || xcb_connection_has_error(state->connection) != 0) {
      reset_xcb_connection(state);
    }
    invalidate_watch(state, "WATCH_REPAIR_MUTATION_FAILED");
    state->watch_repair_failures++;
    free_pending(&fence_pending, 1);
    goto completed;
  }
  free_pending(&fence_pending, 1);
  state->watch_repair_mutations += mutation_count;
  free(root_tree);
  root_tree = NULL;
  free_surface_results(surfaces, state->watch_surface_count);
  memset(surfaces, 0, sizeof(surfaces));
  for (size_t index = 0; index < state->watch_surface_count; index++) {
    surfaces[index].request = state->watch_targets[index];
  }
  result = watch_snapshot_surfaces(state, surfaces, state->watch_surface_count, &root_tree,
                                   deadline_ns);
  if (result != COLLECT_OK || !watch_repair_final_state(state, surfaces,
                                                        state->watch_surface_count, root_tree)) {
    if (result == COLLECT_REPLY_TIMEOUT) state->xcb_timeouts++;
    if (collect_requires_connection_reset(result)) reset_xcb_connection(state);
    invalidate_watch(state, "WATCH_REPAIR_FINAL_MISMATCH");
    state->watch_repair_failures++;
  } else {
    /* The final snapshot is after our checked writes, so discard the
     * Configure/Property notifications those writes generated. A later
     * external event will re-arm the lease through the normal event loop. */
    state->watch_repair_pending = false;
  }

completed:
  state->mutation_started = false;
  state->watch_repair_in_flight = false;
  free(root_tree);
  free_checked_mutations(mutations, mutation_count);
  free_surface_results(surfaces, state->watch_surface_count);
}

static bool verify_identity_unchanged(SurfaceResult *surfaces, size_t count, int64_t deadline_ns) {
  for (size_t index = 0; index < count; index++) {
    uid_t uid = (uid_t)-1;
    unsigned long long starttime = 0;
    if (remaining_timeout_ms(deadline_ns) <= 0 ||
        !read_proc_identity(surfaces[index].pid, &uid, NULL, &starttime) ||
        uid != surfaces[index].uid || starttime != surfaces[index].pid_starttime ||
        !pid_tree_matches_profile(surfaces[index].pid, surfaces[index].request.profile, deadline_ns)) {
      surfaces[index].ok = false;
      surfaces[index].code = remaining_timeout_ms(deadline_ns) <= 0
        ? "TRANSACTION_DEADLINE_EXCEEDED" : "WINDOW_IDENTITY_CHANGED";
      return false;
    }
  }
  return true;
}

static void capture_surface_identities(const SurfaceResult *surfaces,
                                       SurfaceIdentity identities[MAX_SURFACES], size_t count) {
  for (size_t index = 0; index < count; index++) {
    identities[index] = (SurfaceIdentity){
      .pid = surfaces[index].pid,
      .uid = surfaces[index].uid,
      .starttime = surfaces[index].pid_starttime,
    };
  }
}

static bool verify_final_surface_identities(SurfaceResult *surfaces,
                                            const SurfaceIdentity identities[MAX_SURFACES],
                                            size_t count, int64_t deadline_ns) {
  for (size_t index = 0; index < count; index++) {
    uid_t uid = (uid_t)-1;
    unsigned long long starttime = 0;
    if (remaining_timeout_ms(deadline_ns) <= 0) {
      surfaces[index].ok = false;
      surfaces[index].code = "TRANSACTION_DEADLINE_EXCEEDED";
      return false;
    }
    if (surfaces[index].pid != identities[index].pid ||
        !read_proc_identity(surfaces[index].pid, &uid, NULL, &starttime) ||
        uid != identities[index].uid || starttime != identities[index].starttime) {
      surfaces[index].ok = false;
      surfaces[index].code = "WINDOW_IDENTITY_CHANGED";
      return false;
    }
  }
  return true;
}

static bool request_matches_active_lease(const HelperState *state, const char *instance_id,
                                         uint64_t epoch, uint64_t generation,
                                         const char *lease_id) {
  return state->lease_active && strcmp(instance_id, state->daemon_instance_id) == 0 &&
         epoch == state->connection_epoch && generation == state->lease_generation &&
         strcmp(lease_id, state->lease_id) == 0 && monotonic_ns() < state->lease_expires_ns;
}

static json_object *cached_response(HelperState *state, const char *request_id,
                                    const char *packet, size_t packet_length,
                                    bool *conflict) {
  *conflict = false;
  for (size_t index = 0; index < REQUEST_CACHE_SIZE; index++) {
    CachedRequest *entry = &state->request_cache[index];
    if (!entry->used || strcmp(entry->request_id, request_id) != 0) continue;
    if (entry->request_length != packet_length ||
        memcmp(entry->request, packet, packet_length) != 0) {
      *conflict = true;
      return NULL;
    }
    return json_tokener_parse(entry->response);
  }
  return NULL;
}

static void cache_response(HelperState *state, const char *request_id,
                           const char *packet, size_t packet_length,
                           json_object *response) {
  const char *encoded = json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN);
  size_t encoded_length = strlen(encoded);
  CachedRequest *entry;
  if (!request_id[0] || strlen(request_id) > MAX_REQUEST_ID ||
      packet_length > MAX_PACKET_BYTES || encoded_length > MAX_PACKET_BYTES) {
    return;
  }
  entry = &state->request_cache[state->next_cache_slot++ % REQUEST_CACHE_SIZE];
  memset(entry, 0, sizeof(*entry));
  entry->used = true;
  snprintf(entry->request_id, sizeof(entry->request_id), "%s", request_id);
  memcpy(entry->request, packet, packet_length);
  entry->request[packet_length] = '\0';
  entry->request_length = packet_length;
  memcpy(entry->response, encoded, encoded_length + 1);
  entry->response_length = encoded_length;
}

static void add_surface_array(json_object *response, SurfaceResult *surfaces, size_t count) {
  json_object *array = json_object_new_array();
  for (size_t index = 0; index < count; index++) {
    json_object_array_add(array, surface_to_json(&surfaces[index]));
  }
  json_object_object_add(response, "surfaces", array);
}

static json_object *switch_result_response(HelperState *state, const char *request_id,
                                           const char *code, bool ok, bool mutation_started,
                                           SurfaceResult *surfaces, size_t surface_count,
                                           CheckedMutation *mutations, size_t mutation_count,
                                           json_object *timings,
                                           const CollectorDiagnostics *collector_diagnostics) {
  json_object *response = base_response(state, request_id, "switch");
  json_object_object_add(response, "ok", json_object_new_boolean(ok));
  json_object_object_add(response, "code", json_object_new_string(code));
  json_object_object_add(response, "errorCode", ok ? NULL : json_object_new_string(code));
  json_object_object_add(response, "mutationStarted", json_object_new_boolean(mutation_started));
  json_object_object_add(response, "fallbackRecommended", json_object_new_boolean(!ok));
  add_surface_array(response, surfaces, surface_count);
  json_object_object_add(response, "mutations",
                         checked_mutations_to_json(mutations, mutation_count));
  if (timings) json_object_object_add(response, "timings", timings);
  add_collector_diagnostics(response, collector_diagnostics);
  return response;
}

static json_object *switch_response(HelperState *state, json_object *request,
                                    const char *request_id, int64_t received_ns) {
  SurfaceResult surfaces[3] = {0};
  SurfaceIdentity initial_identities[MAX_SURFACES] = {0};
  SurfaceResult *target;
  SurfaceResult *previous;
  SurfaceResult *panel;
  PendingReply initial_pending[MAX_PENDING] = {0};
  PendingReply final_pending[MAX_PENDING] = {0};
  PendingReply fence_pending = {0};
  CheckedMutation mutations[MAX_MUTATIONS] = {0};
  AsyncError initial_async_error = {0};
  AsyncError mutation_async_error = {0};
  const char *instance_id;
  const char *lease_id;
  int64_t epoch_value;
  int64_t generation_value;
  int64_t lease_duration_ms = 350;
  uint64_t generation;
  uint64_t epoch;
  int64_t deadline_ns = received_ns + (int64_t)state->transaction_timeout_ms * 1000000LL;
  int64_t initial_started_ns = monotonic_ns();
  int64_t initial_queued_ns = -1;
  int64_t initial_completed_ns = -1;
  int64_t identity_completed_ns = -1;
  int64_t mutation_started_ns = -1;
  int64_t mutation_queued_ns = -1;
  int64_t fence_completed_ns = -1;
  int64_t checked_completed_ns = -1;
  int64_t final_started_ns = -1;
  int64_t final_completed_ns = -1;
  int64_t final_identity_completed_ns = -1;
  size_t initial_pending_count = 0;
  size_t final_pending_count = 0;
  size_t mutation_count = 0;
  int result;
  CollectorDiagnostics collector_diagnostics = {0};
  bool has_collector_diagnostics = false;
  bool mutation_started = false;
  const char *code = "OK";
  json_object *timings = NULL;
  json_object *lease_duration_value = NULL;
  json_object *response;

  state->switch_requests++;
  if (!get_required_string(request, "daemonInstanceId", &instance_id) ||
      !get_required_string(request, "leaseId", &lease_id) || strlen(lease_id) >= sizeof(state->lease_id) ||
      !get_required_int64(request, "connectionEpoch", &epoch_value) || epoch_value <= 0 ||
      !get_required_int64(request, "generation", &generation_value) || generation_value <= 0 ||
      !parse_switch_surfaces(request, surfaces)) {
    state->switch_failures++;
    return error_response(state, request_id, "switch", "INVALID_SWITCH_REQUEST");
  }
  if (json_object_object_get_ex(request, "leaseDurationMs", &lease_duration_value)) {
    if (!json_object_is_type(lease_duration_value, json_type_int)) {
      state->switch_failures++;
      return error_response(state, request_id, "switch", "INVALID_LEASE_DURATION");
    }
    lease_duration_ms = json_object_get_int64(lease_duration_value);
    if (lease_duration_ms <= state->transaction_timeout_ms ||
        lease_duration_ms > MAX_LEASE_DURATION_MS) {
      state->switch_failures++;
      return error_response(state, request_id, "switch", "INVALID_LEASE_DURATION");
    }
  }
  generation = (uint64_t)generation_value;
  epoch = (uint64_t)epoch_value;
  load_generation_floor(state);
  if (!state->connection || !state->screen) code = "XCB_DISCONNECTED";
  else if (state->generation_state != GENERATION_OK) code = "GENERATION_UNAVAILABLE";
  else if (strcmp(instance_id, state->daemon_instance_id) != 0) code = "DAEMON_INSTANCE_MISMATCH";
  else if (epoch != state->connection_epoch) code = "CONNECTION_EPOCH_MISMATCH";
  else if (generation < state->generation_floor) code = "STALE_GENERATION";
  else if (generation > state->generation_floor) code = "GENERATION_NOT_PUBLISHED";
  else if (state->in_flight) code = "BUSY";
  if (strcmp(code, "OK") != 0) {
    state->switch_failures++;
    return error_response(state, request_id, "switch", code);
  }

  if (state->lease_active && monotonic_ns() >= state->lease_expires_ns) release_lease(state);
  if (state->lease_active) {
    if (generation == state->lease_generation && strcmp(lease_id, state->lease_id) != 0) {
      state->switch_failures++;
      return error_response(state, request_id, "switch", "LEASE_CONFLICT");
    }
    if (generation <= state->lease_generation) {
      state->switch_failures++;
      return error_response(state, request_id, "switch", "LEASE_ALREADY_ACTIVE");
    }
    release_lease(state);
  }

  state->lease_active = true;
  snprintf(state->lease_id, sizeof(state->lease_id), "%s", lease_id);
  state->lease_generation = generation;
  state->lease_epoch = epoch;
  state->lease_expires_ns = received_ns + lease_duration_ms * 1000000LL;
  state->lease_surface_count = 3;
  for (size_t index = 0; index < 3; index++) {
    state->lease_surfaces[index] = surfaces[index].request.xid;
  }
  state->mutation_started = false;
  state->in_flight = true;

  initial_pending_count = queue_surface_queries(state, surfaces, 3, initial_pending);
  initial_queued_ns = monotonic_ns();
  if (xcb_flush(state->connection) <= 0) {
    result = COLLECT_XCB_CONNECTION_ERROR;
    collector_diagnostics = (CollectorDiagnostics){
      .result = COLLECT_XCB_CONNECTION_ERROR,
      .connection_error = xcb_connection_has_error(state->connection),
      .pending_count = initial_pending_count,
    };
    snapshot_pending_diagnostics(&collector_diagnostics, initial_pending, initial_pending_count);
    has_collector_diagnostics = true;
  } else {
    result = finish_surface_queries(state, surfaces, 3, initial_pending, initial_pending_count,
                                    deadline_ns, &initial_async_error, true);
  }
  initial_completed_ns = monotonic_ns();
  if (result != 0) {
    if (!has_collector_diagnostics && state->last_collect.result != COLLECT_OK) {
      collector_diagnostics = state->last_collect;
      has_collector_diagnostics = true;
    }
    code = result == SURFACE_QUERY_DEADLINE_EXCEEDED ? "TRANSACTION_DEADLINE_EXCEEDED" :
           result == SURFACE_QUERY_FAILED ? "WINDOW_INSPECTION_FAILED" :
           collect_error_code(result);
    if (result == COLLECT_REPLY_TIMEOUT) state->xcb_timeouts++;
    if (collect_requires_connection_reset(result)) reset_xcb_connection(state);
    goto completed;
  }

  target = surface_for_role(surfaces, 3, "target");
  previous = surface_for_role(surfaces, 3, "previous");
  panel = surface_for_role(surfaces, 3, "panel");
  if (!target || !previous || !panel) {
    code = "INVALID_SWITCH_ROLES";
    goto completed;
  }
  int32_t configure_x;
  int32_t configure_y;
  if (!configure_coordinates(previous, &configure_x, &configure_y) ||
      !configure_coordinates(target, &configure_x, &configure_y) ||
      !configure_coordinates(panel, &configure_x, &configure_y)) {
    code = "WINDOW_PARENT_MISMATCH";
    goto completed;
  }
  if (!verify_identity_unchanged(surfaces, 3, deadline_ns)) {
    code = remaining_timeout_ms(deadline_ns) <= 0
      ? "TRANSACTION_DEADLINE_EXCEEDED" : "WINDOW_IDENTITY_CHANGED";
    goto completed;
  }
  identity_completed_ns = monotonic_ns();
  capture_surface_identities(surfaces, initial_identities, 3);
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  if (self_test_before_mutation_hook) self_test_before_mutation_hook();
#endif
  if (!request_matches_active_lease(state, instance_id, epoch, generation, lease_id)) {
    code = monotonic_ns() >= state->lease_expires_ns ? "LEASE_EXPIRED" : "LEASE_MISMATCH";
    goto completed;
  }

  state->mutation_started = true;
  mutation_started = true;
  state->mutation_requests++;
  mutation_started_ns = monotonic_ns();
  if (!surface_at_target_geometry(previous) &&
      !queue_geometry_mutation(state, previous, false, mutations, &mutation_count,
                               "previous_geometry")) {
    code = "WINDOW_PARENT_MISMATCH";
    goto completed;
  }
  if (!surface_at_target_opacity(target)) {
    queue_opacity_mutation(state, target, mutations, &mutation_count, "target_opacity");
  }
  if (!surface_at_target_geometry(target) &&
      !queue_geometry_mutation(state, target, true, mutations, &mutation_count,
                               "target_geometry")) {
    code = "WINDOW_PARENT_MISMATCH";
    goto completed;
  }
  if (!surface_at_target_geometry(panel) &&
      !queue_geometry_mutation(state, panel, false, mutations, &mutation_count,
                               "panel_geometry")) {
    code = "WINDOW_PARENT_MISMATCH";
    goto completed;
  }
  if (!surface_at_target_opacity(panel)) {
    queue_opacity_mutation(state, panel, mutations, &mutation_count, "panel_opacity");
  }
  queue_raise_mutation(state, target, mutations, &mutation_count, "target_raise");
  queue_raise_mutation(state, panel, mutations, &mutation_count, "panel_raise");
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  if (self_test_bad_match_sibling != XCB_WINDOW_NONE) {
    uint32_t values[2] = {self_test_bad_match_sibling, XCB_STACK_MODE_ABOVE};
    add_checked_mutation(mutations, &mutation_count,
      xcb_configure_window_checked(state->connection, target->request.xid,
                                   XCB_CONFIG_WINDOW_SIBLING |
                                   XCB_CONFIG_WINDOW_STACK_MODE, values),
      "self_test_bad_match", target->request.xid);
  }
#endif
  xcb_get_input_focus_cookie_t fence = xcb_get_input_focus(state->connection);
  fence_pending.sequence = fence.sequence;
  mutation_queued_ns = monotonic_ns();
  if (xcb_flush(state->connection) <= 0) {
    result = COLLECT_XCB_CONNECTION_ERROR;
    collector_diagnostics = (CollectorDiagnostics){
      .result = COLLECT_XCB_CONNECTION_ERROR,
      .connection_error = xcb_connection_has_error(state->connection),
      .pending_count = 1,
    };
    snapshot_pending_diagnostics(&collector_diagnostics, &fence_pending, 1);
    has_collector_diagnostics = true;
  } else {
    result = collect_replies(state, &fence_pending, 1, deadline_ns, &mutation_async_error);
  }
  if (result != COLLECT_OK ||
      fence_pending.error || !fence_pending.reply) {
    if (result != COLLECT_OK && !has_collector_diagnostics &&
        state->last_collect.result != COLLECT_OK) {
      collector_diagnostics = state->last_collect;
      has_collector_diagnostics = true;
    }
    code = result != COLLECT_OK ? collect_error_code(result) : "XCB_FENCE_FAILED";
    if (result == COLLECT_REPLY_TIMEOUT) state->xcb_timeouts++;
    free_pending(&fence_pending, 1);
    free_pending(final_pending, final_pending_count);
    reset_xcb_connection(state);
    goto completed;
  }
  free_pending(&fence_pending, 1);
  fence_completed_ns = monotonic_ns();
  result = collect_checked_mutations(state, mutations, mutation_count);
  checked_completed_ns = monotonic_ns();
  if (result != 0) {
    code = result == -1 ? "XCB_CHECK_NOT_READY_AFTER_FENCE" : "XCB_MUTATION_ERROR";
    reset_xcb_connection(state);
    goto completed;
  }
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  if (self_test_before_final_query_hook) self_test_before_final_query_hook();
#endif
  for (size_t index = 0; index < 3; index++) clear_surface_result_data(&surfaces[index]);
  final_started_ns = monotonic_ns();
  final_pending_count = queue_surface_queries(state, surfaces, 3, final_pending);
  if (xcb_flush(state->connection) <= 0) {
    result = COLLECT_XCB_CONNECTION_ERROR;
    collector_diagnostics = (CollectorDiagnostics){
      .result = COLLECT_XCB_CONNECTION_ERROR,
      .connection_error = xcb_connection_has_error(state->connection),
      .pending_count = final_pending_count,
    };
    snapshot_pending_diagnostics(&collector_diagnostics, final_pending, final_pending_count);
    free_pending(final_pending, final_pending_count);
    has_collector_diagnostics = true;
  } else {
    result = finish_surface_queries(state, surfaces, 3, final_pending, final_pending_count,
                                    deadline_ns, &mutation_async_error, false);
  }
  final_completed_ns = monotonic_ns();
  if (result != 0) {
    if (!has_collector_diagnostics && state->last_collect.result != COLLECT_OK) {
      collector_diagnostics = state->last_collect;
      has_collector_diagnostics = true;
    }
    code = result == SURFACE_QUERY_DEADLINE_EXCEEDED ? "TRANSACTION_DEADLINE_EXCEEDED" :
           result == SURFACE_QUERY_FAILED ? "FINAL_QUERY_FAILED" :
           collect_error_code(result);
    if (result == COLLECT_REPLY_TIMEOUT) state->xcb_timeouts++;
    if (collect_requires_connection_reset(result)) reset_xcb_connection(state);
    goto completed;
  }
  if (!verify_final_surface_identities(surfaces, initial_identities, 3, deadline_ns)) {
    code = remaining_timeout_ms(deadline_ns) <= 0
      ? "TRANSACTION_DEADLINE_EXCEEDED" : "WINDOW_IDENTITY_CHANGED";
    goto completed;
  }
  final_identity_completed_ns = monotonic_ns();
  target = surface_for_role(surfaces, 3, "target");
  previous = surface_for_role(surfaces, 3, "previous");
  panel = surface_for_role(surfaces, 3, "panel");
  if (!target || !previous || !panel || !surface_at_target_geometry(target) ||
      !surface_at_target_geometry(previous) || !surface_at_target_geometry(panel) ||
      !surface_at_target_opacity(target) || !surface_at_target_opacity(panel) ||
      mutation_async_error.seen ||
      xcb_connection_has_error(state->connection) != 0) {
    code = "FINAL_STATE_MISMATCH";
    goto completed;
  }

completed:
  state->in_flight = false;
  if (strcmp(code, "OK") != 0) state->switch_failures++;
  timings = json_object_new_object();
  json_object_object_add(timings, "requestReceivedMonotonicNs",
                         json_object_new_int64(received_ns));
  json_object_object_add(timings, "initialSnapshotStartedMonotonicNs",
                         json_object_new_int64(initial_started_ns));
  json_object_object_add(timings, "initialSnapshotCompletedMonotonicNs",
                         json_object_new_int64(initial_completed_ns));
  json_object_object_add(timings, "mutationStartedMonotonicNs",
                         json_object_new_int64(mutation_started_ns));
  json_object_object_add(timings, "mutationQueuedMonotonicNs",
                         json_object_new_int64(mutation_queued_ns));
  json_object_object_add(timings, "fenceCompletedMonotonicNs",
                         json_object_new_int64(fence_completed_ns));
  json_object_object_add(timings, "checkedCompletedMonotonicNs",
                         json_object_new_int64(checked_completed_ns));
  json_object_object_add(timings, "finalSnapshotStartedMonotonicNs",
                         json_object_new_int64(final_started_ns));
  json_object_object_add(timings, "finalSnapshotCompletedMonotonicNs",
                         json_object_new_int64(final_completed_ns));
  json_object_object_add(timings, "finalIdentityCompletedMonotonicNs",
                         json_object_new_int64(final_identity_completed_ns));
  json_object_object_add(timings, "initialBatchSendMs",
                         duration_ms_json(initial_started_ns, initial_queued_ns));
  json_object_object_add(timings, "initialReplyAndIdentityMs",
                         duration_ms_json(initial_queued_ns, initial_completed_ns));
  json_object_object_add(timings, "identityRecheckMs",
                         duration_ms_json(initial_completed_ns, identity_completed_ns));
  json_object_object_add(timings, "mutationBatchSendMs",
                         duration_ms_json(identity_completed_ns, mutation_queued_ns));
  json_object_object_add(timings, "fenceMs",
                         duration_ms_json(mutation_queued_ns, fence_completed_ns));
  json_object_object_add(timings, "checkedMs",
                         duration_ms_json(fence_completed_ns, checked_completed_ns));
  json_object_object_add(timings, "finalQueryMs",
                         duration_ms_json(checked_completed_ns, final_completed_ns));
  json_object_object_add(timings, "finalIdentityRecheckMs",
                         duration_ms_json(final_completed_ns, final_identity_completed_ns));
  json_object_object_add(timings, "totalMs",
                         duration_ms_json(received_ns, monotonic_ns()));
  response = switch_result_response(state, request_id, code, strcmp(code, "OK") == 0,
                                    mutation_started, surfaces, 3, mutations, mutation_count,
                                    timings,
                                    has_collector_diagnostics ? &collector_diagnostics : NULL);
  free_checked_mutations(mutations, mutation_count);
  free_surface_results(surfaces, 3);
  return response;
}

static json_object *revoke_response(HelperState *state, json_object *request,
                                    const char *request_id) {
  const char *instance_id;
  const char *lease_id;
  int64_t epoch;
  int64_t generation;
  int64_t revoke_ns = monotonic_ns();
  json_object *response;
  state->revoke_requests++;
  if (!get_required_string(request, "daemonInstanceId", &instance_id) ||
      !get_required_string(request, "leaseId", &lease_id) ||
      !get_required_int64(request, "connectionEpoch", &epoch) || epoch <= 0 ||
      !get_required_int64(request, "generation", &generation) || generation <= 0) {
    return error_response(state, request_id, "revoke", "INVALID_REVOKE_REQUEST");
  }
  if (state->in_flight) return error_response(state, request_id, "revoke", "BUSY");
  if (!state->lease_active) {
    response = base_response(state, request_id, "revoke");
    json_object_object_add(response, "ok", json_object_new_boolean(true));
    json_object_object_add(response, "code", json_object_new_string("ALREADY_RELEASED"));
    json_object_object_add(response, "revokeMonotonicNs", json_object_new_int64(revoke_ns));
    return response;
  }
  if (strcmp(instance_id, state->daemon_instance_id) != 0 ||
      (uint64_t)epoch != state->lease_epoch ||
      (uint64_t)generation != state->lease_generation || strcmp(lease_id, state->lease_id) != 0) {
    return error_response(state, request_id, "revoke", "LEASE_MISMATCH");
  }
  release_lease(state);
  response = base_response(state, request_id, "revoke");
  json_object_object_add(response, "ok", json_object_new_boolean(true));
  json_object_object_add(response, "code", json_object_new_string("REVOKED"));
  json_object_object_add(response, "revokeMonotonicNs", json_object_new_int64(revoke_ns));
  return response;
}

static bool watch_target_has_geometry(const SurfaceRequest *target, int32_t x, int32_t y,
                                      uint32_t width, uint32_t height) {
  return target->has_target_geometry && target->target_x == x && target->target_y == y &&
         target->target_width == width && target->target_height == height;
}

static bool validate_watch_repair_targets(WatchRepairScope scope,
                                          const SurfaceRequest targets[MAX_SURFACES],
                                          size_t surface_count) {
  bool active_seen = false;
  bool previous_seen = false;
  bool panel_seen = false;
  if (scope == WATCH_REPAIR_OBSERVE) return true;
  if (scope == WATCH_REPAIR_PANEL) {
    return surface_count == 1 && strcmp(targets[0].role, "panel") == 0 &&
           targets[0].profile[0] &&
           watch_target_has_geometry(&targets[0], 1920, 0, 640, 720) &&
           targets[0].has_target_opacity && targets[0].target_opacity == UINT32_MAX;
  }
  if (surface_count != 3) return false;
  for (size_t index = 0; index < surface_count; index++) {
    const SurfaceRequest *target = &targets[index];
    if (!target->profile[0] || !target->has_target_geometry) return false;
    if (strcmp(target->role, "active") == 0 && !active_seen) {
      active_seen = true;
      if (!watch_target_has_geometry(target, 0, 0, 1920, 720) ||
          !target->has_target_opacity || target->target_opacity != UINT32_MAX) return false;
    } else if (strcmp(target->role, "previous") == 0 && !previous_seen) {
      previous_seen = true;
      if (!watch_target_has_geometry(target, 2560, 0, 1920, 720) ||
          target->has_target_opacity) return false;
    } else if (strcmp(target->role, "panel") == 0 && !panel_seen) {
      panel_seen = true;
      if (!watch_target_has_geometry(target, 1920, 0, 640, 720) ||
          !target->has_target_opacity || target->target_opacity != UINT32_MAX) return false;
    } else {
      return false;
    }
  }
  return active_seen && previous_seen && panel_seen;
}

static bool parse_watch_request(json_object *request, const char **instance_id,
                                const char **lease_id, uint64_t *epoch, uint64_t *generation,
                                int64_t *lease_duration_ms,
                                SurfaceRequest targets[MAX_SURFACES],
                                WatchRepairScope *repair_scope, size_t *surface_count) {
  json_object *surfaces_value = NULL;
  json_object *duration_value = NULL;
  json_object *scope_value = NULL;
  int64_t epoch_value;
  int64_t generation_value;
  int64_t duration = DEFAULT_WATCH_LEASE_DURATION_MS;
  const char *scope_name = "observe";
  if (!get_required_string(request, "daemonInstanceId", instance_id) ||
      !get_required_string(request, "leaseId", lease_id) || strlen(*lease_id) >= 80 ||
      !get_required_int64(request, "connectionEpoch", &epoch_value) || epoch_value <= 0 ||
      !get_required_int64(request, "generation", &generation_value) || generation_value <= 0 ||
      !json_object_object_get_ex(request, "surfaces", &surfaces_value) ||
      !json_object_is_type(surfaces_value, json_type_array)) {
    return false;
  }
  if (json_object_object_get_ex(request, "leaseDurationMs", &duration_value)) {
    if (!json_object_is_type(duration_value, json_type_int)) return false;
    duration = json_object_get_int64(duration_value);
  }
  if (json_object_object_get_ex(request, "repairScope", &scope_value)) {
    if (!json_object_is_type(scope_value, json_type_string)) return false;
    scope_name = json_object_get_string(scope_value);
  }
  if (strcmp(scope_name, "observe") == 0) *repair_scope = WATCH_REPAIR_OBSERVE;
  else if (strcmp(scope_name, "panel") == 0) *repair_scope = WATCH_REPAIR_PANEL;
  else if (strcmp(scope_name, "provider") == 0) *repair_scope = WATCH_REPAIR_PROVIDER;
  else return false;
  *surface_count = json_object_array_length(surfaces_value);
  if (*surface_count == 0 || *surface_count > MAX_SURFACES || duration <= 0 ||
      duration > MAX_WATCH_LEASE_DURATION_MS) return false;
  for (size_t index = 0; index < *surface_count; index++) {
    json_object *surface = json_object_array_get_idx(surfaces_value, index);
    json_object *xid_value = NULL;
    const char *role;
    const char *profile = "";
    int64_t xid;
    if (!surface || !json_object_is_type(surface, json_type_object) ||
        !get_required_string(surface, "role", &role) || strlen(role) >= MAX_ROLE ||
        !json_object_object_get_ex(surface, "xid", &xid_value) ||
        !json_object_is_type(xid_value, json_type_int)) {
      return false;
    }
    xid = json_object_get_int64(xid_value);
    if (xid <= 0 || xid > UINT32_MAX) return false;
    strncpy(targets[index].role, role, sizeof(targets[index].role) - 1);
    targets[index].role[sizeof(targets[index].role) - 1] = '\0';
    targets[index].xid = (xcb_window_t)xid;
    if (*repair_scope != WATCH_REPAIR_OBSERVE) {
      if (!get_required_string(surface, "profile", &profile) || strlen(profile) >= PATH_MAX ||
          !parse_target_geometry(surface, &targets[index]) ||
          !parse_target_opacity(surface, &targets[index])) return false;
      snprintf(targets[index].profile, sizeof(targets[index].profile), "%s", profile);
    }
    for (size_t previous = 0; previous < index; previous++) {
      if (targets[previous].xid == targets[index].xid) return false;
    }
  }
  *epoch = (uint64_t)epoch_value;
  *generation = (uint64_t)generation_value;
  *lease_duration_ms = duration;
  return validate_watch_repair_targets(*repair_scope, targets, *surface_count);
}

static bool parse_watch_lease_request(json_object *request, const char **instance_id,
                                      const char **lease_id, uint64_t *epoch,
                                      uint64_t *generation, int64_t *lease_duration_ms,
                                      bool allow_default_duration) {
  json_object *duration_value = NULL;
  int64_t epoch_value;
  int64_t generation_value;
  int64_t duration = DEFAULT_WATCH_LEASE_DURATION_MS;
  if (!get_required_string(request, "daemonInstanceId", instance_id) ||
      !get_required_string(request, "leaseId", lease_id) ||
      !get_required_int64(request, "connectionEpoch", &epoch_value) || epoch_value <= 0 ||
      !get_required_int64(request, "generation", &generation_value) || generation_value <= 0) {
    return false;
  }
  if (json_object_object_get_ex(request, "leaseDurationMs", &duration_value)) {
    if (!json_object_is_type(duration_value, json_type_int)) return false;
    duration = json_object_get_int64(duration_value);
  } else if (!allow_default_duration) {
    duration = 0;
  }
  if (duration < 0 || duration > MAX_WATCH_LEASE_DURATION_MS) return false;
  *epoch = (uint64_t)epoch_value;
  *generation = (uint64_t)generation_value;
  *lease_duration_ms = duration;
  return true;
}

static int select_watch_subscriptions(HelperState *state, int64_t deadline_ns) {
  xcb_void_cookie_t subscriptions[MAX_SURFACES + 1] = {0};
  PendingReply fence = {0};
  AsyncError async_error = {0};
  size_t count = 0;
  uint32_t surface_mask = XCB_EVENT_MASK_STRUCTURE_NOTIFY | XCB_EVENT_MASK_PROPERTY_CHANGE;
  uint32_t root_mask = XCB_EVENT_MASK_SUBSTRUCTURE_NOTIFY;
  int result;
  for (size_t index = 0; index < state->watch_surface_count; index++) {
    subscriptions[count++] = xcb_change_window_attributes_checked(
      state->connection, state->watch_surfaces[index], XCB_CW_EVENT_MASK, &surface_mask);
  }
  subscriptions[count++] = xcb_change_window_attributes_checked(
    state->connection, state->screen->root, XCB_CW_EVENT_MASK, &root_mask);
  fence.sequence = xcb_get_input_focus(state->connection).sequence;
  if (xcb_flush(state->connection) <= 0) return COLLECT_XCB_CONNECTION_ERROR;
  result = collect_replies(state, &fence, 1, deadline_ns, &async_error);
  if (result == COLLECT_OK && !async_error.seen && !fence.error && fence.reply) {
    for (size_t index = 0; index < count; index++) {
      void *reply = NULL;
      xcb_generic_error_t *error = NULL;
      int ready = xcb_poll_for_reply(state->connection, subscriptions[index].sequence,
                                     &reply, &error);
      free(reply);
      if (!ready || error) result = SURFACE_QUERY_FAILED;
      free(error);
    }
  } else if (result == COLLECT_OK) {
    result = SURFACE_QUERY_FAILED;
  }
  free_pending(&fence, 1);
  return result;
}

static void clear_watch_subscriptions(HelperState *state) {
  uint32_t mask = 0;
  if (!state->connection || !state->screen) return;
  for (size_t index = 0; index < state->watch_surface_count; index++) {
    (void)xcb_change_window_attributes(state->connection, state->watch_surfaces[index],
                                       XCB_CW_EVENT_MASK, &mask);
  }
  (void)xcb_change_window_attributes(state->connection, state->screen->root,
                                     XCB_CW_EVENT_MASK, &mask);
  (void)xcb_flush(state->connection);
}

static void release_watch(HelperState *state, const char *reason, bool clear_subscriptions) {
  if (clear_subscriptions) clear_watch_subscriptions(state);
  state->watch_valid = false;
  state->watch_lease_id[0] = '\0';
  state->watch_generation = 0;
  state->watch_epoch = 0;
  state->watch_expires_ns = 0;
  state->watch_surface_count = 0;
  state->watch_repair_scope = WATCH_REPAIR_OBSERVE;
  state->watch_repair_pending = false;
  state->watch_repair_in_flight = false;
  memset(state->watch_surfaces, 0, sizeof(state->watch_surfaces));
  memset(state->watch_roles, 0, sizeof(state->watch_roles));
  memset(state->watch_targets, 0, sizeof(state->watch_targets));
  snprintf(state->watch_invalid_reason, sizeof(state->watch_invalid_reason), "%s",
           reason && reason[0] ? reason : "NOT_WATCHING");
}

static void add_watch_surfaces(json_object *response, const HelperState *state) {
  json_object *surfaces = json_object_new_array();
  for (size_t index = 0; index < state->watch_surface_count; index++) {
    json_object *surface = json_object_new_object();
    json_object_object_add(surface, "role", json_object_new_string(state->watch_roles[index]));
    json_object_object_add(surface, "xid", json_object_new_int64(state->watch_surfaces[index]));
    if (watch_repair_scope_has_writes(state)) {
      json_object_object_add(surface, "profile",
                             json_object_new_string(state->watch_targets[index].profile));
    }
    json_object_array_add(surfaces, surface);
  }
  json_object_object_add(response, "surfaces", surfaces);
}

static bool watch_request_matches_active(const HelperState *state,
                                         WatchRepairScope repair_scope,
                                         const SurfaceRequest targets[MAX_SURFACES],
                                         size_t surface_count) {
  if (state->watch_surface_count != surface_count ||
      state->watch_repair_scope != repair_scope) return false;
  for (size_t index = 0; index < surface_count; index++) {
    const SurfaceRequest *active = &state->watch_targets[index];
    const SurfaceRequest *target = &targets[index];
    if (state->watch_surfaces[index] != target->xid ||
        strcmp(state->watch_roles[index], target->role) != 0 ||
        strcmp(active->profile, target->profile) != 0 ||
        active->has_target_geometry != target->has_target_geometry ||
        active->has_target_opacity != target->has_target_opacity ||
        (active->has_target_geometry &&
         (active->target_x != target->target_x || active->target_y != target->target_y ||
          active->target_width != target->target_width ||
          active->target_height != target->target_height)) ||
        (active->has_target_opacity && active->target_opacity != target->target_opacity)) return false;
  }
  return true;
}

static json_object *watch_response(HelperState *state, json_object *request,
                                   const char *request_id, int64_t received_ns) {
  const char *instance_id;
  const char *lease_id;
  SurfaceRequest targets[MAX_SURFACES] = {0};
  SurfaceResult initial_surfaces[MAX_SURFACES] = {0};
  xcb_query_tree_reply_t *initial_root_tree = NULL;
  WatchRepairScope repair_scope;
  uint64_t epoch;
  uint64_t generation;
  int64_t duration_ms;
  size_t surface_count;
  int result;
  json_object *response;
  state->watch_requests++;
  if (!parse_watch_request(request, &instance_id, &lease_id, &epoch, &generation, &duration_ms,
                           targets, &repair_scope, &surface_count)) {
    return error_response(state, request_id, "watch", "INVALID_WATCH_REQUEST");
  }
  load_generation_floor(state);
  refresh_watch_validity(state);
  if (!state->connection || !state->screen) {
    return error_response(state, request_id, "watch", "XCB_DISCONNECTED");
  }
  if (strcmp(instance_id, state->daemon_instance_id) != 0) {
    return error_response(state, request_id, "watch", "DAEMON_INSTANCE_MISMATCH");
  }
  if (epoch != state->connection_epoch) {
    return error_response(state, request_id, "watch", "CONNECTION_EPOCH_MISMATCH");
  }
  if (state->generation_state != GENERATION_OK || generation != state->generation_floor) {
    return error_response(state, request_id, "watch", "GENERATION_MISMATCH");
  }
  if (state->watch_valid && (strcmp(lease_id, state->watch_lease_id) != 0 ||
                             !watch_request_matches_active(state, repair_scope,
                                                           targets, surface_count))) {
    return error_response(state, request_id, "watch", "LEASE_CONFLICT");
  }
  if (state->watch_valid) {
    response = base_response(state, request_id, "watch");
    json_object_object_add(response, "ok", json_object_new_boolean(true));
    json_object_object_add(response, "code", json_object_new_string("ALREADY_WATCHING"));
    json_object_object_add(response, "readOnly",
                           json_object_new_boolean(!watch_repair_scope_has_writes(state)));
    json_object_object_add(response, "repairScope",
                           json_object_new_string(watch_repair_scope_name(state->watch_repair_scope)));
    add_watch_surfaces(response, state);
    return response;
  }
  if (state->watch_lease_id[0]) release_watch(state, "WATCH_REPLACED", true);
  if (repair_scope != WATCH_REPAIR_OBSERVE) {
    for (size_t index = 0; index < surface_count; index++) {
      initial_surfaces[index].request = targets[index];
    }
    result = watch_snapshot_surfaces(state, initial_surfaces, surface_count, &initial_root_tree,
                                     received_ns + (int64_t)state->transaction_timeout_ms * 1000000LL);
    free(initial_root_tree);
    if (result != COLLECT_OK) {
      const char *inspection_code = initial_surfaces[0].code
        ? initial_surfaces[0].code : "UNKNOWN";
      response = error_response(state, request_id, "watch", "WATCH_LEASE_INSPECTION_FAILED");
      json_object_object_add(response, "leaseInspectionCode",
                             json_object_new_string(inspection_code));
      free_surface_results(initial_surfaces, surface_count);
      if (result == COLLECT_REPLY_TIMEOUT) state->xcb_timeouts++;
      if (collect_requires_connection_reset(result)) reset_xcb_connection(state);
      return response;
    }
    free_surface_results(initial_surfaces, surface_count);
  }
  for (size_t index = 0; index < surface_count; index++) {
    state->watch_surfaces[index] = targets[index].xid;
    memcpy(state->watch_roles[index], targets[index].role,
           sizeof(state->watch_roles[index]));
    state->watch_roles[index][sizeof(state->watch_roles[index]) - 1] = '\0';
    state->watch_targets[index] = targets[index];
  }
  state->watch_surface_count = surface_count;
  state->watch_repair_scope = repair_scope;
  state->watch_generation = generation;
  state->watch_epoch = epoch;
  state->watch_expires_ns = monotonic_ns() + duration_ms * 1000000LL;
  snprintf(state->watch_lease_id, sizeof(state->watch_lease_id), "%s", lease_id);
  state->watch_event_history_count = 0;
  state->next_watch_event_slot = 0;
  memset(state->watch_event_history, 0, sizeof(state->watch_event_history));
  result = select_watch_subscriptions(state, received_ns + 1000000000LL);
  if (result != COLLECT_OK) {
    release_watch(state, "WATCH_SUBSCRIPTION_FAILED", true);
    if (collect_requires_connection_reset(result)) reset_xcb_connection(state);
    return error_response(state, request_id, "watch", "WATCH_SUBSCRIPTION_FAILED");
  }
  state->watch_valid = true;
  snprintf(state->watch_invalid_reason, sizeof(state->watch_invalid_reason), "%s", "OK");
  response = base_response(state, request_id, "watch");
  json_object_object_add(response, "ok", json_object_new_boolean(true));
  json_object_object_add(response, "code", json_object_new_string("WATCHING"));
  json_object_object_add(response, "readOnly",
                         json_object_new_boolean(!watch_repair_scope_has_writes(state)));
  json_object_object_add(response, "repairScope",
                         json_object_new_string(watch_repair_scope_name(state->watch_repair_scope)));
  json_object_object_add(response, "subscriptionMask",
                         json_object_new_string("StructureNotifyMask|PropertyChangeMask|SubstructureNotifyMask"));
  add_watch_surfaces(response, state);
  return response;
}

static json_object *renew_watch_response(HelperState *state, json_object *request,
                                          const char *request_id) {
  const char *instance_id;
  const char *lease_id;
  uint64_t epoch;
  uint64_t generation;
  int64_t duration_ms;
  json_object *response;
  state->watch_renew_requests++;
  if (!parse_watch_lease_request(request, &instance_id, &lease_id, &epoch, &generation,
                                 &duration_ms, true)) {
    return error_response(state, request_id, "renew-watch", "INVALID_RENEW_WATCH_REQUEST");
  }
  load_generation_floor(state);
  refresh_watch_validity(state);
  if (!state->watch_valid) return error_response(state, request_id, "renew-watch", "WATCH_INVALID");
  if (strcmp(instance_id, state->daemon_instance_id) != 0 || epoch != state->watch_epoch ||
      generation != state->watch_generation || strcmp(lease_id, state->watch_lease_id) != 0) {
    return error_response(state, request_id, "renew-watch", "LEASE_MISMATCH");
  }
  state->watch_expires_ns = monotonic_ns() + duration_ms * 1000000LL;
  response = base_response(state, request_id, "renew-watch");
  json_object_object_add(response, "ok", json_object_new_boolean(true));
  json_object_object_add(response, "code", json_object_new_string("WATCH_RENEWED"));
  json_object_object_add(response, "readOnly",
                         json_object_new_boolean(!watch_repair_scope_has_writes(state)));
  json_object_object_add(response, "repairScope",
                         json_object_new_string(watch_repair_scope_name(state->watch_repair_scope)));
  add_watch_surfaces(response, state);
  return response;
}

static json_object *unwatch_response(HelperState *state, json_object *request,
                                      const char *request_id, const char *operation,
                                      const char *released_code) {
  const char *instance_id;
  const char *lease_id;
  uint64_t epoch;
  uint64_t generation;
  int64_t ignored_duration;
  json_object *response;
  state->watch_unwatch_requests++;
  if (!parse_watch_lease_request(request, &instance_id, &lease_id, &epoch, &generation,
                                 &ignored_duration, false)) {
    return error_response(state, request_id, operation, "INVALID_UNWATCH_REQUEST");
  }
  if (!state->watch_lease_id[0]) {
    response = base_response(state, request_id, operation);
    json_object_object_add(response, "ok", json_object_new_boolean(true));
    json_object_object_add(response, "code", json_object_new_string("ALREADY_RELEASED"));
    json_object_object_add(response, "readOnly", json_object_new_boolean(true));
    return response;
  }
  if (strcmp(instance_id, state->daemon_instance_id) != 0 || epoch != state->watch_epoch ||
      generation != state->watch_generation || strcmp(lease_id, state->watch_lease_id) != 0) {
    return error_response(state, request_id, operation, "LEASE_MISMATCH");
  }
  release_watch(state, "UNWATCHED", true);
  response = base_response(state, request_id, operation);
  json_object_object_add(response, "ok", json_object_new_boolean(true));
  json_object_object_add(response, "code", json_object_new_string(released_code));
  json_object_object_add(response, "readOnly", json_object_new_boolean(true));
  return response;
}

static json_object *inspect_response(HelperState *state, json_object *request,
                                     const char *request_id, int64_t received_ns) {
  json_object *surfaces_value = NULL;
  SurfaceResult surfaces[MAX_SURFACES] = {0};
  PendingReply pending[MAX_PENDING] = {0};
  AsyncError async_error = {0};
  size_t surface_count;
  size_t pending_count = 0;
  int64_t deadline_ns = inspect_deadline_ns(state, received_ns);
  int64_t queue_started_ns = monotonic_ns();
  int64_t queue_completed_ns;
  int64_t replies_completed_ns;
  int64_t identity_completed_ns;
  int collect_result;
  CollectorDiagnostics flush_diagnostics = {0};
  const CollectorDiagnostics *collector_diagnostics = NULL;
  bool all_ok = true;
  const char *overall_code = "OK";
  json_object *response;
  json_object *surface_array;
  json_object *timings;

  state->inspect_requests++;
  if (!json_object_object_get_ex(request, "surfaces", &surfaces_value) ||
      !json_object_is_type(surfaces_value, json_type_array)) {
    state->inspect_failures++;
    return error_response(state, request_id, "inspect", "INVALID_SURFACES");
  }
  surface_count = json_object_array_length(surfaces_value);
  if (surface_count == 0 || surface_count > MAX_SURFACES) {
    state->inspect_failures++;
    return error_response(state, request_id, "inspect", "INVALID_SURFACE_COUNT");
  }
  if (!state->connection || !state->screen) {
    state->inspect_failures++;
    return error_response(state, request_id, "inspect", "XCB_DISCONNECTED");
  }

  for (size_t index = 0; index < surface_count; index++) {
    json_object *surface_value = json_object_array_get_idx(surfaces_value, index);
    json_object *xid_value = NULL;
    const char *role;
    const char *profile;
    int64_t xid;
    xcb_get_geometry_cookie_t geometry;
    xcb_translate_coordinates_cookie_t translate;
    xcb_get_window_attributes_cookie_t attributes;
    xcb_get_property_cookie_t pid;
    xcb_get_property_cookie_t class_value;
    xcb_get_property_cookie_t opacity;
    xcb_query_tree_cookie_t tree;
    if (!surface_value || !json_object_is_type(surface_value, json_type_object) ||
        !get_required_string(surface_value, "role", &role) || strlen(role) >= MAX_ROLE ||
        !get_required_string(surface_value, "profile", &profile) || strlen(profile) >= PATH_MAX ||
        !json_object_object_get_ex(surface_value, "xid", &xid_value) ||
        !json_object_is_type(xid_value, json_type_int)) {
      state->inspect_failures++;
      return error_response(state, request_id, "inspect", "INVALID_SURFACE");
    }
    xid = json_object_get_int64(xid_value);
    if (xid <= 0 || xid > UINT32_MAX) {
      state->inspect_failures++;
      return error_response(state, request_id, "inspect", "INVALID_XID");
    }
    snprintf(surfaces[index].request.role, sizeof(surfaces[index].request.role), "%s", role);
    snprintf(surfaces[index].request.profile, sizeof(surfaces[index].request.profile), "%s", profile);
    surfaces[index].request.xid = (xcb_window_t)xid;

    geometry = xcb_get_geometry(state->connection, surfaces[index].request.xid);
    translate = xcb_translate_coordinates(state->connection, surfaces[index].request.xid,
                                           state->screen->root, 0, 0);
    attributes = xcb_get_window_attributes(state->connection, surfaces[index].request.xid);
    pid = xcb_get_property(state->connection, 0, surfaces[index].request.xid,
                           state->net_wm_pid, XCB_ATOM_CARDINAL, 0, 1);
    class_value = xcb_get_property(state->connection, 0, surfaces[index].request.xid,
                                   XCB_ATOM_WM_CLASS, XCB_ATOM_STRING, 0, MAX_CLASS / 4);
    opacity = xcb_get_property(state->connection, 0, surfaces[index].request.xid,
                               state->net_wm_opacity, XCB_ATOM_CARDINAL, 0, 1);
    tree = xcb_query_tree(state->connection, surfaces[index].request.xid);
    pending[pending_count++] = (PendingReply){
      .sequence = geometry.sequence, .kind = PENDING_GEOMETRY, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = translate.sequence, .kind = PENDING_TRANSLATE, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = attributes.sequence, .kind = PENDING_ATTRIBUTES, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = pid.sequence, .kind = PENDING_PID, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = class_value.sequence, .kind = PENDING_CLASS, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = opacity.sequence, .kind = PENDING_OPACITY, .surface_index = index
    };
    pending[pending_count++] = (PendingReply){
      .sequence = tree.sequence, .kind = PENDING_TREE, .surface_index = index
    };
  }
  queue_completed_ns = monotonic_ns();
  if (xcb_flush(state->connection) <= 0) {
    flush_diagnostics = (CollectorDiagnostics){
      .result = COLLECT_XCB_CONNECTION_ERROR,
      .connection_error = xcb_connection_has_error(state->connection),
      .pending_count = pending_count,
    };
    snapshot_pending_diagnostics(&flush_diagnostics, pending, pending_count);
    collect_result = COLLECT_XCB_CONNECTION_ERROR;
    collector_diagnostics = &flush_diagnostics;
  } else {
    collect_result = collect_replies(state, pending, pending_count, deadline_ns, &async_error);
    collector_diagnostics = &state->last_collect;
  }
  replies_completed_ns = monotonic_ns();
  if (collect_result != 0) {
    state->inspect_failures++;
    if (collect_result == COLLECT_REPLY_TIMEOUT) {
      state->xcb_timeouts++;
    } else {
      overall_code = collect_error_code(collect_result);
    }
    if (collect_result == COLLECT_REPLY_TIMEOUT) overall_code = "X11_REPLY_TIMEOUT";
    response = error_response(state, request_id, "inspect", overall_code);
    add_collector_diagnostics(response, collector_diagnostics);
    free_pending(pending, pending_count);
    if (collect_requires_connection_reset(collect_result)) reset_xcb_connection(state);
    timings = json_object_new_object();
    json_object_object_add(timings, "daemonQueueMs",
                           duration_ms_json(received_ns, queue_started_ns));
    json_object_object_add(timings, "batchSendMs",
                           duration_ms_json(queue_started_ns, queue_completed_ns));
    json_object_object_add(timings, "replyWaitMs",
                           duration_ms_json(queue_completed_ns, replies_completed_ns));
    json_object_object_add(timings, "batchReadMs", NULL);
    json_object_object_add(timings, "totalMs", duration_ms_json(received_ns, monotonic_ns()));
    json_object_object_add(response, "timings", timings);
    return response;
  }

  for (size_t index = 0; index < pending_count; index++) assign_pending_reply(surfaces, &pending[index]);
  free_pending(pending, pending_count);
  for (size_t index = 0; index < surface_count; index++) {
    parse_surface_result(&surfaces[index], deadline_ns, true);
    if (!surfaces[index].ok) all_ok = false;
  }
  identity_completed_ns = monotonic_ns();
  if (remaining_timeout_ms(deadline_ns) <= 0) {
    all_ok = false;
    overall_code = "TRANSACTION_DEADLINE_EXCEEDED";
  } else if (async_error.seen) {
    all_ok = false;
    overall_code = "XCB_ASYNC_ERROR";
  } else if (!all_ok) {
    overall_code = "WINDOW_INSPECTION_FAILED";
  }
  if (!all_ok) state->inspect_failures++;

  response = base_response(state, request_id, "inspect");
  json_object_object_add(response, "ok", json_object_new_boolean(all_ok));
  json_object_object_add(response, "code", json_object_new_string(overall_code));
  json_object_object_add(response, "fallbackRecommended", json_object_new_boolean(false));
  json_object_object_add(response, "readOnly", json_object_new_boolean(true));
  surface_array = json_object_new_array();
  for (size_t index = 0; index < surface_count; index++) {
    json_object_array_add(surface_array, surface_to_json(&surfaces[index]));
  }
  json_object_object_add(response, "surfaces", surface_array);
  timings = json_object_new_object();
  json_object_object_add(timings, "daemonQueueMs",
                         duration_ms_json(received_ns, queue_started_ns));
  json_object_object_add(timings, "batchSendMs",
                         duration_ms_json(queue_started_ns, queue_completed_ns));
  json_object_object_add(timings, "replyWaitMs",
                         duration_ms_json(queue_completed_ns, replies_completed_ns));
  json_object_object_add(timings, "batchReadMs",
                         duration_ms_json(replies_completed_ns, identity_completed_ns));
  json_object_object_add(timings, "procIdentityMs",
                         duration_ms_json(replies_completed_ns, identity_completed_ns));
  json_object_object_add(timings, "totalMs",
                         duration_ms_json(received_ns, identity_completed_ns));
  json_object_object_add(response, "timings", timings);
  if (async_error.seen) {
    json_object *error = json_object_new_object();
    json_object_object_add(error, "errorCode", json_object_new_int(async_error.error_code));
    json_object_object_add(error, "majorCode", json_object_new_int(async_error.major_code));
    json_object_object_add(error, "minorCode", json_object_new_int(async_error.minor_code));
    json_object_object_add(error, "resourceId", json_object_new_int64(async_error.resource_id));
    json_object_object_add(response, "asyncError", error);
  }
  free_surface_results(surfaces, surface_count);
  return response;
}

static json_object *process_request(HelperState *state, const char *packet, size_t packet_length,
                                    int64_t received_ns) {
  json_tokener *tokener = json_tokener_new_ex(32);
  json_object *request = NULL;
  json_object *version_value = NULL;
  const char *request_id = "unknown";
  const char *operation = "unknown";
  enum json_tokener_error parse_error;
  json_object *response;
  bool request_id_valid;
  bool operation_valid;
  bool conflict = false;
  if (!tokener) return error_response(state, request_id, operation, "OUT_OF_MEMORY");
  request = json_tokener_parse_ex(tokener, packet, (int)packet_length);
  parse_error = json_tokener_get_error(tokener);
  size_t parsed_length = json_tokener_get_parse_end(tokener);
  while (parsed_length < packet_length && isspace((unsigned char)packet[parsed_length])) parsed_length++;
  if (parse_error != json_tokener_success || parsed_length != packet_length ||
      !request || !json_object_is_type(request, json_type_object)) {
    if (request) json_object_put(request);
    json_tokener_free(tokener);
    return error_response(state, request_id, operation, "INVALID_JSON");
  }
  json_tokener_free(tokener);
  request_id_valid = get_required_string(request, "requestId", &request_id) &&
                     strlen(request_id) <= MAX_REQUEST_ID;
  operation_valid = get_required_string(request, "operation", &operation);
  if (request_id_valid) {
    response = cached_response(state, request_id, packet, packet_length, &conflict);
    if (response) {
      json_object_put(request);
      return response;
    }
    if (conflict) {
      response = error_response(state, request_id, operation, "REQUEST_ID_CONFLICT");
      json_object_put(request);
      return response;
    }
  }
  if (!request_id_valid || !operation_valid) {
    response = error_response(state, request_id, operation, "INVALID_REQUEST_ENVELOPE");
  } else if (!json_object_object_get_ex(request, "version", &version_value) ||
      !json_object_is_type(version_value, json_type_int) || json_object_get_int(version_value) != 1) {
    response = error_response(state, request_id, operation, "UNSUPPORTED_VERSION");
  } else if (strcmp(operation, "health") == 0) {
    if (!state->connection) {
      (void)connect_xcb(state, true,
                        received_ns + (int64_t)state->transaction_timeout_ms * 1000000LL);
    }
    load_generation_floor(state);
    refresh_watch_validity(state);
    response = health_response(state, request_id);
  } else if (strcmp(operation, "inspect") == 0 &&
             request_has_caller_role(request, "window_guard") &&
             foreground_switch_marker_active(state)) {
    state->guard_paused_requests++;
    response = error_response(state, request_id, operation, "GUARD_PAUSED_FOR_SWITCH");
  } else if (strcmp(operation, "inspect") == 0) {
    if (!state->connection) {
      (void)connect_xcb(state, true,
                        received_ns + (int64_t)state->transaction_timeout_ms * 1000000LL);
    }
    load_generation_floor(state);
    response = inspect_response(state, request, request_id, received_ns);
  } else if (strcmp(operation, "screen-probe") == 0) {
    if (foreground_switch_marker_active(state)) {
      response = error_response(state, request_id, operation, "SCREEN_PROBE_PAUSED_FOR_SWITCH");
    } else {
      response = screen_probe_response(state, request_id, received_ns);
    }
  } else if (strcmp(operation, "switch") == 0) {
    if (state->phase != 1) {
      response = error_response(state, request_id, operation,
                                state->phase == 0 ? "OPERATION_DISABLED_PHASE0" :
                                                    "OPERATION_DISABLED_PHASE3");
    } else {
      if (!state->connection) {
        (void)connect_xcb(state, true,
                          received_ns + (int64_t)state->transaction_timeout_ms * 1000000LL);
      }
      response = switch_response(state, request, request_id, received_ns);
    }
  } else if (strcmp(operation, "watch") == 0) {
    response = state->phase == 3
      ? watch_response(state, request, request_id, received_ns)
      : error_response(state, request_id, operation,
                       state->phase == 0 ? "OPERATION_DISABLED_PHASE0" :
                                           "OPERATION_DISABLED_PHASE1");
  } else if (strcmp(operation, "renew-watch") == 0) {
    response = state->phase == 3
      ? renew_watch_response(state, request, request_id)
      : error_response(state, request_id, operation,
                       state->phase == 0 ? "OPERATION_DISABLED_PHASE0" :
                                           "OPERATION_DISABLED_PHASE1");
  } else if (strcmp(operation, "unwatch") == 0) {
    response = state->phase == 3
      ? unwatch_response(state, request, request_id, "unwatch", "UNWATCHED")
      : error_response(state, request_id, operation,
                       state->phase == 0 ? "OPERATION_DISABLED_PHASE0" :
                                           "OPERATION_DISABLED_PHASE1");
  } else if (strcmp(operation, "revoke") == 0) {
    if (state->phase == 0) {
      response = error_response(state, request_id, operation, "OPERATION_DISABLED_PHASE0");
    } else if (state->phase == 3) {
      state->revoke_requests++;
      response = unwatch_response(state, request, request_id, "revoke", "REVOKED");
    } else {
      response = revoke_response(state, request, request_id);
    }
  } else {
    response = error_response(state, request_id, operation, "OPERATION_NOT_IMPLEMENTED");
  }
  if (request_id_valid) cache_response(state, request_id, packet, packet_length, response);
  json_object_put(request);
  return response;
}

static int set_nonblocking(int descriptor);

static int create_listener(const char *socket_path) {
  int descriptor;
  struct sockaddr_un address = {0};
  struct stat status;
  if (strlen(socket_path) >= sizeof(address.sun_path)) {
    fprintf(stderr, "socket path too long: %s\n", socket_path);
    return -1;
  }
  if (lstat(socket_path, &status) == 0) {
    if (!S_ISSOCK(status.st_mode)) {
      fprintf(stderr, "refusing to replace non-socket path: %s\n", socket_path);
      return -1;
    }
    if (unlink(socket_path) != 0) {
      perror("unlink socket");
      return -1;
    }
  } else if (errno != ENOENT) {
    perror("lstat socket");
    return -1;
  }
  descriptor = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (descriptor < 0) {
    perror("socket");
    return -1;
  }
  address.sun_family = AF_UNIX;
  snprintf(address.sun_path, sizeof(address.sun_path), "%s", socket_path);
  if (bind(descriptor, (struct sockaddr *)&address, sizeof(address)) != 0 ||
      chmod(socket_path, 0600) != 0 || listen(descriptor, 16) != 0) {
    perror("bind/listen socket");
    close(descriptor);
    unlink(socket_path);
    return -1;
  }
  return descriptor;
}

static int poll_socket_until(int descriptor, short events, int64_t deadline_ns) {
  struct pollfd item = {.fd = descriptor, .events = events};
  int result;
  do {
    int timeout_ms = remaining_timeout_ms(deadline_ns);
    if (timeout_ms <= 0) return 0;
    item.revents = 0;
    result = poll(&item, 1, timeout_ms);
  } while (result < 0 && errno == EINTR);
  if (result <= 0) return result;
  if (item.revents & events) return 1;
  if (item.revents & (POLLERR | POLLHUP | POLLNVAL)) return -1;
  return -1;
}

static int read_exact_until(int descriptor, void *buffer, size_t length,
                            int64_t deadline_ns, size_t *received) {
  unsigned char *cursor = buffer;
  *received = 0;
  while (*received < length) {
    ssize_t count = recv(descriptor, cursor + *received, length - *received, 0);
    if (count > 0) {
      *received += (size_t)count;
      continue;
    }
    if (count == 0) return 1;
    if (errno == EINTR) continue;
    if (errno == EAGAIN || errno == EWOULDBLOCK) {
      int poll_result = poll_socket_until(descriptor, POLLIN, deadline_ns);
      if (poll_result == 0) return 2;
      if (poll_result < 0) return -1;
      continue;
    }
    return -1;
  }
  return 0;
}

static int write_exact_until(int descriptor, const void *buffer, size_t length,
                             int64_t deadline_ns) {
  const unsigned char *cursor = buffer;
  size_t sent = 0;
  while (sent < length) {
    ssize_t count = send(descriptor, cursor + sent, length - sent, MSG_NOSIGNAL);
    if (count > 0) {
      sent += (size_t)count;
      continue;
    }
    if (count < 0 && errno == EINTR) continue;
    if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
      int poll_result = poll_socket_until(descriptor, POLLOUT, deadline_ns);
      if (poll_result <= 0) return -1;
      continue;
    }
    return -1;
  }
  return 0;
}

static FrameResult read_frame(int descriptor, char payload[MAX_PACKET_BYTES + 1],
                              size_t *payload_length, int timeout_ms) {
  uint32_t network_length = 0;
  size_t received = 0;
  int64_t deadline_ns = monotonic_ns() + (int64_t)timeout_ms * 1000000LL;
  int result = read_exact_until(descriptor, &network_length, sizeof(network_length),
                                deadline_ns, &received);
  if (result == 1) return received == 0 ? FRAME_EOF : FRAME_PARTIAL_HEADER;
  if (result == 2) return received == 0 ? FRAME_TIMEOUT : FRAME_PARTIAL_HEADER;
  if (result != 0) return FRAME_IO_ERROR;
  *payload_length = ntohl(network_length);
  if (*payload_length < 1 || *payload_length > MAX_PACKET_BYTES) return FRAME_INVALID_LENGTH;
  result = read_exact_until(descriptor, payload, *payload_length, deadline_ns, &received);
  if (result == 1) return FRAME_PARTIAL_PAYLOAD;
  if (result == 2) return FRAME_TIMEOUT;
  if (result != 0) return FRAME_IO_ERROR;
  payload[*payload_length] = '\0';
  return FRAME_OK;
}

static int write_frame(int descriptor, const char *payload, size_t payload_length, int timeout_ms) {
  uint32_t network_length;
  int64_t deadline_ns;
  if (payload_length < 1 || payload_length > MAX_PACKET_BYTES) return -1;
  network_length = htonl((uint32_t)payload_length);
  deadline_ns = monotonic_ns() + (int64_t)timeout_ms * 1000000LL;
  if (write_exact_until(descriptor, &network_length, sizeof(network_length), deadline_ns) != 0) return -1;
  return write_exact_until(descriptor, payload, payload_length, deadline_ns);
}

static const char *frame_error_code(FrameResult result) {
  switch (result) {
    case FRAME_PARTIAL_HEADER: return "PROTOCOL_PARTIAL_HEADER";
    case FRAME_INVALID_LENGTH: return "PROTOCOL_INVALID_LENGTH";
    case FRAME_PARTIAL_PAYLOAD: return "PROTOCOL_PARTIAL_PAYLOAD";
    case FRAME_TIMEOUT: return "PROTOCOL_TIMEOUT";
    case FRAME_IO_ERROR: return "PROTOCOL_IO_ERROR";
    case FRAME_EOF: return "PROTOCOL_EARLY_EOF";
    case FRAME_OK: return "OK";
  }
  return "PROTOCOL_ERROR";
}

static bool peer_allowed(int descriptor) {
#ifdef SO_PEERCRED
  struct ucred credentials;
  socklen_t length = sizeof(credentials);
  if (getsockopt(descriptor, SOL_SOCKET, SO_PEERCRED, &credentials, &length) != 0) return false;
  return credentials.uid == 0 || credentials.uid == geteuid();
#elif defined(__APPLE__)
  uid_t uid;
  gid_t gid;
  if (getpeereid(descriptor, &uid, &gid) != 0) return false;
  (void)gid;
  return uid == 0 || uid == geteuid();
#else
  (void)descriptor;
  return false;
#endif
}

static int serve(HelperState *state, const char *socket_path) {
  int listener = create_listener(socket_path);
  if (listener < 0) return 1;
  while (!stop_requested) {
    struct pollfd descriptors[2] = {
      {.fd = listener, .events = POLLIN | POLLERR | POLLHUP},
      {.fd = -1, .events = POLLIN | POLLERR | POLLHUP},
    };
    nfds_t descriptor_count = 1;
    int poll_result;
    load_generation_floor(state);
    refresh_watch_validity(state);
    if (state->watch_valid && state->connection) {
      descriptors[descriptor_count++].fd = xcb_get_file_descriptor(state->connection);
    }
    poll_result = poll(descriptors, descriptor_count, 1000);
    if (poll_result < 0) {
      if (errno == EINTR) continue;
      perror("poll listener");
      break;
    }
    if (poll_result == 0) continue;
    if (descriptors[0].revents & (POLLERR | POLLHUP | POLLNVAL)) break;
    if (descriptor_count == 2 && descriptors[1].revents) {
      if (descriptors[1].revents & (POLLERR | POLLHUP | POLLNVAL)) {
        reset_xcb_connection(state);
      } else if (descriptors[1].revents & POLLIN) {
        xcb_generic_event_t *event;
        bool reset_connection = false;
        while ((event = xcb_poll_for_event(state->connection)) != NULL) {
          if ((event->response_type & 0x7fU) == 0) {
            reset_connection = true;
          } else {
            observe_xcb_event(state, event);
          }
          free(event);
          if (reset_connection) break;
        }
        if (reset_connection || xcb_connection_has_error(state->connection) != 0) {
          reset_xcb_connection(state);
        }
      }
    }
    if (descriptors[0].revents & POLLIN) {
      int client = accept_cloexec(listener);
      char packet[MAX_PACKET_BYTES + 1];
      size_t packet_length = 0;
      int64_t received_ns;
      json_object *response;
      const char *encoded;
      size_t encoded_length;
      FrameResult frame_result;
      uint64_t epoch_before = state->connection_epoch;
      uint64_t timeouts_before = state->xcb_timeouts;
      uint64_t reconnects_before = state->reconnects;
      if (client < 0) {
        if (errno == EINTR) continue;
        perror("accept");
        break;
      }
      if (set_nonblocking(client) != 0) {
        close(client);
        continue;
      }
      state->total_requests++;
      if (!peer_allowed(client)) {
        response = error_response(state, "unknown", "unknown", "PEER_NOT_ALLOWED");
      } else {
        frame_result = read_frame(client, packet, &packet_length, SERVER_FRAME_TIMEOUT_MS);
        received_ns = monotonic_ns();
        if (frame_result == FRAME_EOF) {
          close(client);
          continue;
        }
        if (frame_result == FRAME_OK) {
          log_request_started(state, packet, packet_length, received_ns, epoch_before);
        }
        response = frame_result == FRAME_OK
          ? process_request(state, packet, packet_length, received_ns)
          : error_response(state, "unknown", "unknown", frame_error_code(frame_result));
        if (frame_result == FRAME_TIMEOUT) state->protocol_frame_timeouts++;
        if (frame_result == FRAME_OK && response) {
          log_request_result(state, packet, packet_length, response, received_ns,
                             monotonic_ns(), epoch_before, timeouts_before,
                             reconnects_before);
        }
      }
      if (!response) {
        close(client);
        continue;
      }
      encoded = json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN);
      encoded_length = strlen(encoded);
      if (encoded_length > MAX_PACKET_BYTES) {
        json_object_put(response);
        response = error_response(state, "unknown", "unknown", "RESPONSE_TOO_LARGE");
        encoded = json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN);
        encoded_length = strlen(encoded);
      }
      (void)write_frame(client, encoded, encoded_length, SERVER_FRAME_TIMEOUT_MS);
      json_object_put(response);
      close(client);
    }
    /* A watch event can arrive while an inspect/watch request is draining its
     * reply queue.  Defer the lease-owned write until that client is fully
     * answered so the two bounded XCB transactions never interleave. */
    repair_watched_surfaces(state);
  }
  close(listener);
  unlink(socket_path);
  return 0;
}

static int set_nonblocking(int descriptor) {
  int flags = fcntl(descriptor, F_GETFL, 0);
  return flags < 0 || fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) != 0 ? -1 : 0;
}

static int client_exchange(const char *socket_path, const char *request, int connect_timeout_ms,
                           int response_timeout_ms, char response[MAX_PACKET_BYTES + 1],
                           int64_t *connect_elapsed_ns, int64_t *response_elapsed_ns,
                           int64_t *total_elapsed_ns) {
  int descriptor = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  struct sockaddr_un address = {0};
  int connect_result;
  socklen_t error_length;
  int socket_error = 0;
  size_t response_length = 0;
  int64_t started_ns = monotonic_ns();
  int64_t connected_ns;
  int64_t request_sent_ns;
  FrameResult frame_result;
  if (descriptor < 0 || set_nonblocking(descriptor) != 0) {
    if (descriptor >= 0) close(descriptor);
    return 69;
  }
  if (strlen(socket_path) >= sizeof(address.sun_path)) {
    close(descriptor);
    return 64;
  }
  address.sun_family = AF_UNIX;
  snprintf(address.sun_path, sizeof(address.sun_path), "%s", socket_path);
  connect_result = connect(descriptor, (struct sockaddr *)&address, sizeof(address));
  if (connect_result != 0 && errno != EINPROGRESS) {
    close(descriptor);
    return 69;
  }
  if (connect_result != 0) {
    int64_t deadline_ns = monotonic_ns() + (int64_t)connect_timeout_ms * 1000000LL;
    if (poll_socket_until(descriptor, POLLOUT, deadline_ns) != 1) {
      close(descriptor);
      return 69;
    }
    error_length = sizeof(socket_error);
    if (getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &socket_error, &error_length) != 0 || socket_error != 0) {
      close(descriptor);
      return 69;
    }
  }
  connected_ns = monotonic_ns();
  if (write_frame(descriptor, request, strlen(request), response_timeout_ms) != 0) {
    close(descriptor);
    return 70;
  }
  request_sent_ns = monotonic_ns();
  frame_result = read_frame(descriptor, response, &response_length, response_timeout_ms);
  close(descriptor);
  if (frame_result != FRAME_OK) return 70;
  int64_t completed_ns = monotonic_ns();
  *connect_elapsed_ns = connected_ns - started_ns;
  *response_elapsed_ns = completed_ns - request_sent_ns;
  *total_elapsed_ns = completed_ns - started_ns;
  return 0;
}

static int read_stdin_packet(char output[MAX_PACKET_BYTES + 1]) {
  size_t total = 0;
  while (total < MAX_PACKET_BYTES) {
    size_t count = fread(output + total, 1, MAX_PACKET_BYTES - total, stdin);
    total += count;
    if (count == 0) break;
  }
  if (ferror(stdin) || total == 0) return -1;
  if (total == MAX_PACKET_BYTES) {
    int extra = fgetc(stdin);
    if (extra != EOF || ferror(stdin)) return -1;
  } else if (!feof(stdin)) {
    return -1;
  }
  output[total] = '\0';
  return 0;
}

static int positive_env_ms(const char *name, int fallback) {
  const char *value = getenv(name);
  char *end = NULL;
  long parsed;
  if (!value || !value[0]) return fallback;
  errno = 0;
  parsed = strtol(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || parsed <= 0 || parsed >= 10000) return fallback;
  return (int)parsed;
}

static bool parse_phase(const char *value, int *phase) {
  if (strcmp(value, "0") == 0) {
    *phase = 0;
    return true;
  }
  if (strcmp(value, "1") == 0) {
    *phase = 1;
    return true;
  }
  if (strcmp(value, "3") == 0) {
    *phase = 3;
    return true;
  }
  return false;
}

static bool owner_publish_state_valid(json_object *state) {
  json_object *owner_value = NULL;
  json_object *generation_value = NULL;
  json_object *surfaces = NULL;
  const char *owner;
  bool seen_target = false;
  bool seen_previous = false;
  bool seen_panel = false;
  if (!state || !json_object_is_type(state, json_type_object) ||
      !json_object_object_get_ex(state, "owner", &owner_value) ||
      !json_object_is_type(owner_value, json_type_string) ||
      !json_object_object_get_ex(state, "generation", &generation_value) ||
      !json_object_is_type(generation_value, json_type_int) ||
      json_object_get_int64(generation_value) <= 0 ||
      !json_object_object_get_ex(state, "surfaces", &surfaces) ||
      !json_object_is_type(surfaces, json_type_array)) {
    return false;
  }
  owner = json_object_get_string(owner_value);
  if (strcmp(owner, "shell") == 0) return json_object_array_length(surfaces) == 0;
  if (strcmp(owner, "helper") != 0 || json_object_array_length(surfaces) != 3) return false;
  for (size_t index = 0; index < json_object_array_length(surfaces); index++) {
    json_object *surface = json_object_array_get_idx(surfaces, index);
    json_object *role_value = NULL;
    json_object *xid_value = NULL;
    const char *role;
    int64_t xid;
    if (!surface || !json_object_is_type(surface, json_type_object) ||
        !json_object_object_get_ex(surface, "role", &role_value) ||
        !json_object_is_type(role_value, json_type_string) ||
        !json_object_object_get_ex(surface, "xid", &xid_value) ||
        !json_object_is_type(xid_value, json_type_int)) {
      return false;
    }
    role = json_object_get_string(role_value);
    xid = json_object_get_int64(xid_value);
    if (xid <= 0 || xid > UINT32_MAX) return false;
    if (strcmp(role, "target") == 0 && !seen_target) seen_target = true;
    else if (strcmp(role, "previous") == 0 && !seen_previous) seen_previous = true;
    else if (strcmp(role, "panel") == 0 && !seen_panel) seen_panel = true;
    else return false;
  }
  return seen_target && seen_previous && seen_panel;
}

static int ensure_owner_parent_directory(const char *path) {
  char parent[PATH_MAX];
  char *slash;
  struct stat metadata;
  if (!path || strlen(path) >= sizeof(parent)) return -1;
  snprintf(parent, sizeof(parent), "%s", path);
  slash = strrchr(parent, '/');
  if (!slash) return 0;
  if (slash == parent) return 0;
  *slash = '\0';
  if (stat(parent, &metadata) == 0) return S_ISDIR(metadata.st_mode) ? 0 : -1;
  for (char *cursor = parent + 1; *cursor; cursor++) {
    if (*cursor != '/') continue;
    *cursor = '\0';
    if (mkdir(parent, 0700) != 0 && errno != EEXIST) return -1;
    *cursor = '/';
  }
  return mkdir(parent, 0700) == 0 || errno == EEXIST ? 0 : -1;
}

static int write_owner_state_atomically(const char *path, const char *state_json) {
  char temporary_path[PATH_MAX];
  struct stat existing;
  int descriptor = -1;
  size_t offset = 0;
  size_t length;
  if (!path || !state_json || ensure_owner_parent_directory(path) != 0 ||
      snprintf(temporary_path, sizeof(temporary_path), "%s.tmp.XXXXXX", path) >=
        (int)sizeof(temporary_path)) {
    return -1;
  }
  descriptor = mkstemp(temporary_path);
  if (descriptor < 0) return -1;
  if (stat(path, &existing) == 0 && fchmod(descriptor, existing.st_mode & 07777) != 0) goto failed;
  length = strlen(state_json);
  while (offset < length) {
    ssize_t written = write(descriptor, state_json + offset, length - offset);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) goto failed;
    offset += (size_t)written;
  }
  if (write(descriptor, "\n", 1) != 1 || close(descriptor) != 0) {
    descriptor = -1;
    goto failed;
  }
  descriptor = -1;
  if (rename(temporary_path, path) != 0) goto failed;
  return 0;

failed:
  if (descriptor >= 0) close(descriptor);
  unlink(temporary_path);
  return -1;
}

static int run_owner_publish(int argc, char **argv) {
  const char *path = NULL;
  const char *state_text = NULL;
  json_object *state = NULL;
  const char *canonical = NULL;
  for (int index = 2; index < argc; index++) {
    if (strcmp(argv[index], "--file") == 0 && index + 1 < argc) path = argv[++index];
    else if (strcmp(argv[index], "--json") == 0 && index + 1 < argc) state_text = argv[++index];
    else return 64;
  }
  if (!path || !state_text || strlen(path) >= PATH_MAX || strlen(state_text) >= MAX_PACKET_BYTES) return 64;
  state = json_tokener_parse(state_text);
  if (!owner_publish_state_valid(state)) {
    if (state) json_object_put(state);
    return 64;
  }
  canonical = json_object_to_json_string_ext(state, JSON_C_TO_STRING_PLAIN);
  if (!canonical || write_owner_state_atomically(path, canonical) != 0) {
    json_object_put(state);
    return 1;
  }
  json_object_put(state);
  return 0;
}

/* The resident switch must prove that it is resuming exactly one known Guard.
 * Doing this in Bash used a command substitution per /proc entry, which could
 * consume several seconds after a completed X11 transaction.  Keep the same
 * PID/starttime and duplicate-Guard checks, but perform the single /proc scan
 * in the native client. */
static bool guard_cmdline_matches(uint32_t pid) {
  char path[64];
  unsigned char command[8192];
  ssize_t length;
  int descriptor;
  bool script_seen = false;
  size_t cursor = 0;
  if (snprintf(path, sizeof(path), "/proc/%u/cmdline", pid) >= (int)sizeof(path)) return false;
  descriptor = open(path, O_RDONLY | O_CLOEXEC);
  if (descriptor < 0) return false;
  length = read(descriptor, command, sizeof(command));
  close(descriptor);
  if (length <= 0 || (size_t)length == sizeof(command)) return false;
  while (cursor < (size_t)length) {
    size_t next = cursor;
    while (next < (size_t)length && command[next] != '\0') next++;
    if (next == cursor) {
      cursor = next + 1;
      continue;
    }
    const char *argument = (const char *)command + cursor;
    size_t argument_length = next - cursor;
    static const char script_suffix[] = "/tikpal-web-mode.sh";
    bool is_script = argument_length == sizeof("tikpal-web-mode.sh") - 1 &&
                     memcmp(argument, "tikpal-web-mode.sh", argument_length) == 0;
    if (!is_script && argument_length >= sizeof(script_suffix) - 1) {
      is_script = memcmp(argument + argument_length - (sizeof(script_suffix) - 1),
                         script_suffix, sizeof(script_suffix) - 1) == 0;
    }
    if (script_seen && argument_length == sizeof("guard") - 1 &&
        memcmp(argument, "guard", sizeof("guard") - 1) == 0) {
      return true;
    }
    script_seen = is_script;
    cursor = next + 1;
  }
  return false;
}

static void log_guard_cmdline(uint32_t pid) {
  char path[64];
  unsigned char command[512];
  ssize_t length;
  int descriptor;
  size_t cursor = 0;
  size_t argument_count = 0;
  if (snprintf(path, sizeof(path), "/proc/%u/cmdline", pid) >= (int)sizeof(path)) return;
  descriptor = open(path, O_RDONLY | O_CLOEXEC);
  if (descriptor < 0) return;
  length = read(descriptor, command, sizeof(command) - 1);
  close(descriptor);
  if (length <= 0) return;
  command[length] = '\0';
  fprintf(stderr, " guard_pid=%u argv=", pid);
  while (cursor < (size_t)length && argument_count < 4) {
    size_t next = cursor;
    while (next < (size_t)length && command[next] != '\0') next++;
    if (next > cursor) {
      if (argument_count > 0) fputc('|', stderr);
      fwrite(command + cursor, 1, next - cursor, stderr);
      argument_count++;
    }
    cursor = next + 1;
  }
}

static int run_guard_process_verify(int argc, char **argv) {
  uint32_t expected_pid = 0;
  unsigned long long expected_starttime = 0;
  char *end = NULL;
  DIR *directory;
  struct dirent *entry;
  size_t matching_count = 0;
  uint32_t matching_pids[8] = {0};
  bool expected_matches = false;
  for (int index = 2; index < argc; index++) {
    if (strcmp(argv[index], "--pid") == 0 && index + 1 < argc) {
      errno = 0;
      unsigned long value = strtoul(argv[++index], &end, 10);
      if (errno != 0 || !end || *end || value == 0 || value > UINT32_MAX) return 64;
      expected_pid = (uint32_t)value;
    } else if (strcmp(argv[index], "--starttime") == 0 && index + 1 < argc) {
      errno = 0;
      expected_starttime = strtoull(argv[++index], &end, 10);
      if (errno != 0 || !end || *end || expected_starttime == 0) return 64;
    } else {
      return 64;
    }
  }
  if (expected_pid == 0 || expected_starttime == 0) return 64;
  directory = opendir("/proc");
  if (!directory) return 1;
  while ((entry = readdir(directory)) != NULL) {
    uint32_t pid;
    uint32_t parent = 0;
    uid_t uid;
    unsigned long long starttime = 0;
    errno = 0;
    unsigned long value = strtoul(entry->d_name, &end, 10);
    if (errno != 0 || !end || *end || value == 0 || value > UINT32_MAX) continue;
    pid = (uint32_t)value;
    if (!guard_cmdline_matches(pid) ||
        !read_proc_identity(pid, &uid, &parent, &starttime) ||
        uid != geteuid()) continue;
    /* Bash command substitutions retain the Guard argv while they run under
     * the real Guard.  They are not separately launched Guard loops. */
    if (parent > 1 && parent != pid && guard_cmdline_matches(parent)) continue;
    if (matching_count < sizeof(matching_pids) / sizeof(matching_pids[0])) {
      matching_pids[matching_count] = pid;
    }
    matching_count++;
    if (pid == expected_pid && starttime == expected_starttime) {
      expected_matches = true;
    }
  }
  closedir(directory);
  if (matching_count == 0) return 1;
  if (matching_count > 1) {
    fprintf(stderr, "guard-process-verify: duplicate guards");
    for (size_t index = 0; index < matching_count && index < sizeof(matching_pids) / sizeof(matching_pids[0]); index++) {
      fprintf(stderr, "%s%u", index == 0 ? " " : ",", matching_pids[index]);
    }
    for (size_t index = 0; index < matching_count && index < sizeof(matching_pids) / sizeof(matching_pids[0]); index++) {
      log_guard_cmdline(matching_pids[index]);
    }
    fputc('\n', stderr);
    return 24;
  }
  return expected_matches ? 0 : 25;
}

static int run_owner_allows(int argc, char **argv) {
  const char *path = NULL;
  const char *generation_path = NULL;
  xcb_window_t requested[MAX_SURFACES] = {0};
  size_t requested_count = 0;
  bool all = false;
  char packet[MAX_PACKET_BYTES + 1];
  char generation_packet[128];
  size_t length;
  size_t generation_length;
  FILE *input;
  FILE *generation_input;
  char *generation_end = NULL;
  unsigned long long generation;
  json_object *owner_state = NULL;
  json_object *owner_value = NULL;
  json_object *owner_generation_value = NULL;
  json_object *surfaces = NULL;
  for (int index = 2; index < argc; index++) {
    if (strcmp(argv[index], "--file") == 0 && index + 1 < argc) {
      path = argv[++index];
    } else if (strcmp(argv[index], "--generation-file") == 0 && index + 1 < argc) {
      generation_path = argv[++index];
    } else if (strcmp(argv[index], "--all") == 0 && !all) {
      all = true;
    } else if (strcmp(argv[index], "--xid") == 0 && index + 1 < argc &&
               requested_count < MAX_SURFACES) {
      char *end = NULL;
      unsigned long xid = strtoul(argv[++index], &end, 10);
      if (!end || *end || xid == 0 || xid > UINT32_MAX) return 64;
      requested[requested_count++] = (xcb_window_t)xid;
    } else {
      return 64;
    }
  }
  if (!path || !generation_path || all == (requested_count > 0)) return 64;
  input = fopen(path, "re");
  if (!input) return errno == ENOENT ? 0 : 24;
  length = fread(packet, 1, MAX_PACKET_BYTES, input);
  if (ferror(input) || (!feof(input) && length == MAX_PACKET_BYTES)) {
    fclose(input);
    return 24;
  }
  fclose(input);
  packet[length] = '\0';
  owner_state = json_tokener_parse(packet);
  if (!owner_state || !json_object_is_type(owner_state, json_type_object) ||
      !json_object_object_get_ex(owner_state, "owner", &owner_value) ||
      !json_object_is_type(owner_value, json_type_string) ||
      !json_object_object_get_ex(owner_state, "generation", &owner_generation_value) ||
      !json_object_is_type(owner_generation_value, json_type_int) ||
      !json_object_object_get_ex(owner_state, "surfaces", &surfaces) ||
      !json_object_is_type(surfaces, json_type_array)) {
    if (owner_state) json_object_put(owner_state);
    fprintf(stderr, "owner-allows: malformed owner state\n");
    return 24;
  }
  generation_input = fopen(generation_path, "re");
  if (!generation_input) {
    json_object_put(owner_state);
    fprintf(stderr, "owner-allows: generation state unavailable\n");
    return 24;
  }
  generation_length = fread(generation_packet, 1, sizeof(generation_packet) - 1,
                            generation_input);
  if (ferror(generation_input) ||
      (!feof(generation_input) && generation_length == sizeof(generation_packet) - 1)) {
    fclose(generation_input);
    json_object_put(owner_state);
    fprintf(stderr, "owner-allows: generation state unreadable\n");
    return 24;
  }
  fclose(generation_input);
  generation_packet[generation_length] = '\0';
  errno = 0;
  generation = strtoull(generation_packet, &generation_end, 10);
  while (generation_end && isspace((unsigned char)*generation_end)) generation_end++;
  if (errno != 0 || generation_end == generation_packet ||
      (generation_end && *generation_end != '\0') || generation == 0 ||
      generation > INT64_MAX || json_object_get_int64(owner_generation_value) <= 0 ||
      (uint64_t)json_object_get_int64(owner_generation_value) != (uint64_t)generation) {
    json_object_put(owner_state);
    fprintf(stderr, "owner-allows: generation mismatch\n");
    return 24;
  }
  const char *owner = json_object_get_string(owner_value);
  if (strcmp(owner, "shell") == 0 || strcmp(owner, "none") == 0) {
    if (json_object_array_length(surfaces) != 0) {
      json_object_put(owner_state);
      fprintf(stderr, "owner-allows: malformed non-helper owner state\n");
      return 24;
    }
    json_object_put(owner_state);
    return 0;
  }
  if (strcmp(owner, "helper") != 0 || json_object_array_length(surfaces) == 0 ||
      json_object_array_length(surfaces) > MAX_SURFACES) {
    json_object_put(owner_state);
    fprintf(stderr, "owner-allows: invalid owner state\n");
    return 24;
  }
  for (size_t index = 0; index < json_object_array_length(surfaces); index++) {
    json_object *surface = json_object_array_get_idx(surfaces, index);
    json_object *xid_value = NULL;
    int64_t xid;
    if (!surface || !json_object_is_type(surface, json_type_object) ||
        !json_object_object_get_ex(surface, "xid", &xid_value) ||
        !json_object_is_type(xid_value, json_type_int)) {
      json_object_put(owner_state);
      fprintf(stderr, "owner-allows: malformed helper surface\n");
      return 24;
    }
    xid = json_object_get_int64(xid_value);
    if (xid <= 0 || xid > UINT32_MAX) {
      json_object_put(owner_state);
      fprintf(stderr, "owner-allows: invalid helper surface\n");
      return 24;
    }
    for (size_t requested_index = 0; requested_index < requested_count; requested_index++) {
      if (xid == requested[requested_index]) {
        json_object_put(owner_state);
        return 24;
      }
    }
  }
  json_object_put(owner_state);
  return all ? 24 : 0;
}

static json_object *build_inspect_request(int argc, char **argv, int start_index,
                                          const char **socket_path, int *connect_timeout_ms,
                                          int *response_timeout_ms) {
  const char *request_id = NULL;
  int64_t generation = 0;
  json_object *request = json_object_new_object();
  json_object *surfaces = json_object_new_array();
  for (int index = start_index; index < argc; index++) {
    if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) {
      *socket_path = argv[++index];
    } else if (strcmp(argv[index], "--connect-timeout-ms") == 0 && index + 1 < argc) {
      *connect_timeout_ms = atoi(argv[++index]);
    } else if (strcmp(argv[index], "--response-timeout-ms") == 0 && index + 1 < argc) {
      *response_timeout_ms = atoi(argv[++index]);
    } else if (strcmp(argv[index], "--request-id") == 0 && index + 1 < argc) {
      request_id = argv[++index];
    } else if (strcmp(argv[index], "--generation") == 0 && index + 1 < argc) {
      generation = strtoll(argv[++index], NULL, 10);
    } else if (strcmp(argv[index], "--surface") == 0 && index + 3 < argc) {
      const char *role = argv[++index];
      char *end = NULL;
      unsigned long xid = strtoul(argv[++index], &end, 10);
      const char *profile = argv[++index];
      json_object *surface;
      if (!end || *end || xid == 0 || xid > UINT32_MAX) goto invalid;
      surface = json_object_new_object();
      json_object_object_add(surface, "role", json_object_new_string(role));
      json_object_object_add(surface, "xid", json_object_new_int64((int64_t)xid));
      json_object_object_add(surface, "profile", json_object_new_string(profile));
      json_object_array_add(surfaces, surface);
    } else {
      goto invalid;
    }
  }
  if (!request_id || json_object_array_length(surfaces) == 0 ||
      *connect_timeout_ms <= 0 || *response_timeout_ms <= 0) goto invalid;
  json_object_object_add(request, "version", json_object_new_int(1));
  json_object_object_add(request, "requestId", json_object_new_string(request_id));
  json_object_object_add(request, "operation", json_object_new_string("inspect"));
  json_object_object_add(request, "generation", json_object_new_int64(generation));
  json_object_object_add(request, "surfaces", surfaces);
  return request;

invalid:
  json_object_put(surfaces);
  json_object_put(request);
  return NULL;
}

static json_object *build_switch_request(int argc, char **argv, int start_index,
                                         const char **socket_path, int *connect_timeout_ms,
                                         int *response_timeout_ms) {
  const char *request_id = NULL;
  const char *instance_id = NULL;
  const char *lease_id = NULL;
  int64_t epoch = 0;
  int64_t generation = 0;
  int64_t lease_duration_ms = 350;
  json_object *request = json_object_new_object();
  json_object *surfaces = json_object_new_array();
  for (int index = start_index; index < argc; index++) {
    if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) {
      *socket_path = argv[++index];
    } else if (strcmp(argv[index], "--connect-timeout-ms") == 0 && index + 1 < argc) {
      *connect_timeout_ms = atoi(argv[++index]);
    } else if (strcmp(argv[index], "--response-timeout-ms") == 0 && index + 1 < argc) {
      *response_timeout_ms = atoi(argv[++index]);
    } else if (strcmp(argv[index], "--request-id") == 0 && index + 1 < argc) {
      request_id = argv[++index];
    } else if (strcmp(argv[index], "--daemon-instance-id") == 0 && index + 1 < argc) {
      instance_id = argv[++index];
    } else if (strcmp(argv[index], "--connection-epoch") == 0 && index + 1 < argc) {
      epoch = strtoll(argv[++index], NULL, 10);
    } else if (strcmp(argv[index], "--generation") == 0 && index + 1 < argc) {
      generation = strtoll(argv[++index], NULL, 10);
    } else if (strcmp(argv[index], "--lease-id") == 0 && index + 1 < argc) {
      lease_id = argv[++index];
    } else if (strcmp(argv[index], "--lease-duration-ms") == 0 && index + 1 < argc) {
      lease_duration_ms = strtoll(argv[++index], NULL, 10);
    } else if (strcmp(argv[index], "--surface") == 0 && index + 8 < argc) {
      const char *role = argv[++index];
      char *end = NULL;
      unsigned long xid = strtoul(argv[++index], &end, 10);
      const char *profile = argv[++index];
      long x = strtol(argv[++index], NULL, 10);
      long y = strtol(argv[++index], NULL, 10);
      unsigned long width = strtoul(argv[++index], NULL, 10);
      unsigned long height = strtoul(argv[++index], NULL, 10);
      const char *opacity_text = argv[++index];
      char *opacity_end = NULL;
      unsigned long long opacity = 0;
      json_object *surface;
      json_object *geometry;
      if (!end || *end || xid == 0 || xid > UINT32_MAX || x < INT32_MIN || x > INT32_MAX ||
          y < INT32_MIN || y > INT32_MAX || width == 0 || width > UINT16_MAX ||
          height == 0 || height > UINT16_MAX) goto invalid_switch;
      if (strcmp(opacity_text, "keep") != 0) {
        errno = 0;
        opacity = strtoull(opacity_text, &opacity_end, 0);
        if (errno != 0 || !opacity_end || *opacity_end || opacity > UINT32_MAX) {
          goto invalid_switch;
        }
      }
      surface = json_object_new_object();
      geometry = json_object_new_object();
      json_object_object_add(surface, "role", json_object_new_string(role));
      json_object_object_add(surface, "xid", json_object_new_int64((int64_t)xid));
      json_object_object_add(surface, "profile", json_object_new_string(profile));
      json_object_object_add(geometry, "x", json_object_new_int64(x));
      json_object_object_add(geometry, "y", json_object_new_int64(y));
      json_object_object_add(geometry, "width", json_object_new_int64((int64_t)width));
      json_object_object_add(geometry, "height", json_object_new_int64((int64_t)height));
      json_object_object_add(surface, "geometry", geometry);
      if (strcmp(opacity_text, "keep") != 0) {
        json_object_object_add(surface, "targetOpacity", json_object_new_int64((int64_t)opacity));
      }
      json_object_array_add(surfaces, surface);
    } else {
      goto invalid_switch;
    }
  }
  if (!request_id || !instance_id || !lease_id || epoch <= 0 || generation <= 0 ||
      json_object_array_length(surfaces) != 3 || *connect_timeout_ms <= 0 ||
      *response_timeout_ms <= 0 || lease_duration_ms <= 0) goto invalid_switch;
  json_object_object_add(request, "version", json_object_new_int(1));
  json_object_object_add(request, "requestId", json_object_new_string(request_id));
  json_object_object_add(request, "operation", json_object_new_string("switch"));
  json_object_object_add(request, "daemonInstanceId", json_object_new_string(instance_id));
  json_object_object_add(request, "connectionEpoch", json_object_new_int64(epoch));
  json_object_object_add(request, "generation", json_object_new_int64(generation));
  json_object_object_add(request, "leaseId", json_object_new_string(lease_id));
  json_object_object_add(request, "leaseDurationMs", json_object_new_int64(lease_duration_ms));
  json_object_object_add(request, "surfaces", surfaces);
  return request;

invalid_switch:
  json_object_put(surfaces);
  json_object_put(request);
  return NULL;
}

static json_object *build_revoke_request(int argc, char **argv, int start_index,
                                         const char **socket_path, int *connect_timeout_ms,
                                         int *response_timeout_ms) {
  const char *request_id = NULL;
  const char *instance_id = NULL;
  const char *lease_id = NULL;
  int64_t epoch = 0;
  int64_t generation = 0;
  json_object *request = json_object_new_object();
  for (int index = start_index; index < argc; index++) {
    if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) *socket_path = argv[++index];
    else if (strcmp(argv[index], "--connect-timeout-ms") == 0 && index + 1 < argc) *connect_timeout_ms = atoi(argv[++index]);
    else if (strcmp(argv[index], "--response-timeout-ms") == 0 && index + 1 < argc) *response_timeout_ms = atoi(argv[++index]);
    else if (strcmp(argv[index], "--request-id") == 0 && index + 1 < argc) request_id = argv[++index];
    else if (strcmp(argv[index], "--daemon-instance-id") == 0 && index + 1 < argc) instance_id = argv[++index];
    else if (strcmp(argv[index], "--connection-epoch") == 0 && index + 1 < argc) epoch = strtoll(argv[++index], NULL, 10);
    else if (strcmp(argv[index], "--generation") == 0 && index + 1 < argc) generation = strtoll(argv[++index], NULL, 10);
    else if (strcmp(argv[index], "--lease-id") == 0 && index + 1 < argc) lease_id = argv[++index];
    else goto invalid_revoke;
  }
  if (!request_id || !instance_id || !lease_id || epoch <= 0 || generation <= 0 ||
      *connect_timeout_ms <= 0 || *response_timeout_ms <= 0) goto invalid_revoke;
  json_object_object_add(request, "version", json_object_new_int(1));
  json_object_object_add(request, "requestId", json_object_new_string(request_id));
  json_object_object_add(request, "operation", json_object_new_string("revoke"));
  json_object_object_add(request, "daemonInstanceId", json_object_new_string(instance_id));
  json_object_object_add(request, "connectionEpoch", json_object_new_int64(epoch));
  json_object_object_add(request, "generation", json_object_new_int64(generation));
  json_object_object_add(request, "leaseId", json_object_new_string(lease_id));
  return request;

invalid_revoke:
  json_object_put(request);
  return NULL;
}

static int run_client(int argc, char **argv) {
  const char *command = argv[1];
  const char *socket_path = getenv("TIKPAL_WEB_MODE_X11_HELPER_SOCKET");
  int connect_timeout_ms = positive_env_ms("TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS",
                                           DEFAULT_CONNECT_TIMEOUT_MS);
  int response_timeout_ms = positive_env_ms("TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS",
                                            DEFAULT_RESPONSE_TIMEOUT_MS);
  char request[MAX_PACKET_BYTES + 1];
  char response[MAX_PACKET_BYTES + 1];
  char default_health_request_id[MAX_REQUEST_ID + 1];
  json_object *request_object = NULL;
  int result;
  int64_t connect_elapsed_ns = 0;
  int64_t response_elapsed_ns = 0;
  int64_t total_elapsed_ns = 0;
  bool health_tsv = false;
  if (strcmp(command, "owner-allows") == 0) return run_owner_allows(argc, argv);
  if (strcmp(command, "owner-publish") == 0) return run_owner_publish(argc, argv);
  if (strcmp(command, "guard-process-verify") == 0) return run_guard_process_verify(argc, argv);
  if (!socket_path || !socket_path[0]) socket_path = getenv("TIKPAL_X11_HELPER_SOCKET");
  if (!socket_path || !socket_path[0]) socket_path = DEFAULT_SOCKET_PATH;

  if (strcmp(command, "health") == 0) {
    snprintf(default_health_request_id, sizeof(default_health_request_id),
             "health-%ld-%" PRId64, (long)getpid(), monotonic_ns());
    const char *request_id = default_health_request_id;
    for (int index = 2; index < argc; index++) {
      if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) socket_path = argv[++index];
      else if (strcmp(argv[index], "--request-id") == 0 && index + 1 < argc) request_id = argv[++index];
      else if (strcmp(argv[index], "--connect-timeout-ms") == 0 && index + 1 < argc) connect_timeout_ms = atoi(argv[++index]);
      else if (strcmp(argv[index], "--response-timeout-ms") == 0 && index + 1 < argc) response_timeout_ms = atoi(argv[++index]);
      else if (strcmp(argv[index], "--format") == 0 && index + 1 < argc &&
               strcmp(argv[index + 1], "tsv") == 0) { health_tsv = true; index++; }
      else return 64;
    }
    request_object = json_object_new_object();
    json_object_object_add(request_object, "version", json_object_new_int(1));
    json_object_object_add(request_object, "requestId", json_object_new_string(request_id));
    json_object_object_add(request_object, "operation", json_object_new_string("health"));
    add_client_metadata(request_object);
    snprintf(request, sizeof(request), "%s",
             json_object_to_json_string_ext(request_object, JSON_C_TO_STRING_PLAIN));
  } else if (strcmp(command, "inspect") == 0) {
    request_object = build_inspect_request(argc, argv, 2, &socket_path,
                                           &connect_timeout_ms, &response_timeout_ms);
    if (!request_object) return 64;
    add_client_metadata(request_object);
    snprintf(request, sizeof(request), "%s",
             json_object_to_json_string_ext(request_object, JSON_C_TO_STRING_PLAIN));
  } else if (strcmp(command, "screen-probe") == 0) {
    const char *request_id = NULL;
    for (int index = 2; index < argc; index++) {
      if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) socket_path = argv[++index];
      else if (strcmp(argv[index], "--request-id") == 0 && index + 1 < argc) request_id = argv[++index];
      else if (strcmp(argv[index], "--connect-timeout-ms") == 0 && index + 1 < argc) connect_timeout_ms = atoi(argv[++index]);
      else if (strcmp(argv[index], "--response-timeout-ms") == 0 && index + 1 < argc) response_timeout_ms = atoi(argv[++index]);
      else return 64;
    }
    if (!request_id || !request_id[0] || connect_timeout_ms <= 0 || response_timeout_ms <= 0) return 64;
    request_object = json_object_new_object();
    json_object_object_add(request_object, "version", json_object_new_int(1));
    json_object_object_add(request_object, "requestId", json_object_new_string(request_id));
    json_object_object_add(request_object, "operation", json_object_new_string("screen-probe"));
    add_client_metadata(request_object);
    snprintf(request, sizeof(request), "%s",
             json_object_to_json_string_ext(request_object, JSON_C_TO_STRING_PLAIN));
  } else if (strcmp(command, "switch") == 0) {
    request_object = build_switch_request(argc, argv, 2, &socket_path,
                                          &connect_timeout_ms, &response_timeout_ms);
    if (!request_object) return 64;
    add_client_metadata(request_object);
    snprintf(request, sizeof(request), "%s",
             json_object_to_json_string_ext(request_object, JSON_C_TO_STRING_PLAIN));
  } else if (strcmp(command, "revoke") == 0) {
    request_object = build_revoke_request(argc, argv, 2, &socket_path,
                                          &connect_timeout_ms, &response_timeout_ms);
    if (!request_object) return 64;
    add_client_metadata(request_object);
    snprintf(request, sizeof(request), "%s",
             json_object_to_json_string_ext(request_object, JSON_C_TO_STRING_PLAIN));
  } else if (strcmp(command, "request") == 0) {
    for (int index = 2; index < argc; index++) {
      if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) socket_path = argv[++index];
      else if (strcmp(argv[index], "--connect-timeout-ms") == 0 && index + 1 < argc) connect_timeout_ms = atoi(argv[++index]);
      else if (strcmp(argv[index], "--response-timeout-ms") == 0 && index + 1 < argc) response_timeout_ms = atoi(argv[++index]);
      else return 64;
    }
    if (read_stdin_packet(request) != 0) return 64;
  } else {
    return 64;
  }

  result = client_exchange(socket_path, request, connect_timeout_ms, response_timeout_ms, response,
                           &connect_elapsed_ns, &response_elapsed_ns, &total_elapsed_ns);
  if (request_object) json_object_put(request_object);
  if (result != 0) return result;
  json_object *parsed = json_tokener_parse(response);
  json_object *ok = NULL;
  if (!parsed || !json_object_object_get_ex(parsed, "ok", &ok)) {
    if (parsed) json_object_put(parsed);
    return 70;
  }
  json_object *client_timings = json_object_new_object();
  json_object_object_add(client_timings, "connectMs", duration_ms_json(0, connect_elapsed_ns));
  json_object_object_add(client_timings, "responseWaitMs", duration_ms_json(0, response_elapsed_ns));
  json_object_object_add(client_timings, "socketTotalMs", duration_ms_json(0, total_elapsed_ns));
  json_object_object_add(parsed, "clientTimings", client_timings);
  if (health_tsv) {
    json_object *instance = NULL;
    json_object *epoch = NULL;
    json_object *in_flight = NULL;
    json_object *generation_state = NULL;
    if (!json_object_get_boolean(ok) ||
        !json_object_object_get_ex(parsed, "daemonInstanceId", &instance) ||
        !json_object_object_get_ex(parsed, "connectionEpoch", &epoch) ||
        !json_object_object_get_ex(parsed, "inFlight", &in_flight) ||
        !json_object_object_get_ex(parsed, "generationState", &generation_state)) {
      json_object_put(parsed);
      return 20;
    }
    printf("%s\t%" PRId64 "\t%d\t%s\n", json_object_get_string(instance),
           json_object_get_int64(epoch), json_object_get_boolean(in_flight),
           json_object_get_string(generation_state));
    json_object_put(parsed);
    return 0;
  }
  printf("%s\n", json_object_to_json_string_ext(parsed, JSON_C_TO_STRING_PLAIN));
  if (json_object_get_boolean(ok)) {
    if (strcmp(command, "revoke") == 0) {
      json_object *released = NULL;
      json_object *in_flight = NULL;
      result = json_object_object_get_ex(parsed, "leaseReleased", &released) &&
               json_object_object_get_ex(parsed, "inFlight", &in_flight) &&
               json_object_get_boolean(released) && !json_object_get_boolean(in_flight) ? 0 : 22;
    } else {
      result = 0;
    }
  } else if (strcmp(command, "switch") == 0) {
    json_object *started = NULL;
    result = json_object_object_get_ex(parsed, "mutationStarted", &started) &&
             json_object_get_boolean(started) ? 21 : 20;
  } else {
    result = 20;
  }
  json_object_put(parsed);
  return result;
}

static int self_test_failure(const char *message) {
  fprintf(stderr, "self-test failed: %s\n", message);
  return 1;
}

static int framing_self_test(void) {
  int descriptors[2];
  pid_t child;
  char payload[MAX_PACKET_BYTES + 1];
  size_t payload_length = 0;
  int status = 0;
  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, descriptors) != 0) {
    return self_test_failure("socketpair");
  }
  child = fork();
  if (child < 0) return self_test_failure("fork");
  if (child == 0) {
    const char value[] = "{\"version\":1}";
    uint32_t length = htonl((uint32_t)(sizeof(value) - 1));
    close(descriptors[0]);
    for (size_t index = 0; index < sizeof(length); index++) {
      if (write(descriptors[1], (const unsigned char *)&length + index, 1) != 1) _exit(2);
    }
    for (size_t index = 0; index < sizeof(value) - 1; index++) {
      if (write(descriptors[1], value + index, 1) != 1) _exit(3);
    }
    close(descriptors[1]);
    _exit(0);
  }
  close(descriptors[1]);
  if (set_nonblocking(descriptors[0]) != 0 ||
      read_frame(descriptors[0], payload, &payload_length, 1000) != FRAME_OK ||
      strcmp(payload, "{\"version\":1}") != 0) {
    close(descriptors[0]);
    return self_test_failure("partial framed read");
  }
  close(descriptors[0]);
  if (waitpid(child, &status, 0) != child || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    return self_test_failure("partial frame writer");
  }

  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, descriptors) != 0) {
    return self_test_failure("invalid-length socketpair");
  }
  uint32_t zero = 0;
  if (write(descriptors[1], &zero, sizeof(zero)) != (ssize_t)sizeof(zero)) {
    return self_test_failure("invalid-length write");
  }
  if (set_nonblocking(descriptors[0]) != 0 ||
      read_frame(descriptors[0], payload, &payload_length, 1000) != FRAME_INVALID_LENGTH) {
    return self_test_failure("zero payload length");
  }
  close(descriptors[0]);
  close(descriptors[1]);

  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, descriptors) != 0) {
    return self_test_failure("partial-payload socketpair");
  }
  uint32_t five = htonl(5);
  if (write(descriptors[1], &five, sizeof(five)) != (ssize_t)sizeof(five) ||
      write(descriptors[1], "ab", 2) != 2) {
    return self_test_failure("partial-payload write");
  }
  shutdown(descriptors[1], SHUT_WR);
  if (set_nonblocking(descriptors[0]) != 0 ||
      read_frame(descriptors[0], payload, &payload_length, 1000) != FRAME_PARTIAL_PAYLOAD) {
    return self_test_failure("partial payload EOF");
  }
  close(descriptors[0]);
  close(descriptors[1]);

  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, descriptors) != 0) {
    return self_test_failure("maximum-payload socketpair");
  }
  child = fork();
  if (child < 0) return self_test_failure("maximum-payload fork");
  if (child == 0) {
    char maximum[MAX_PACKET_BYTES];
    memset(maximum, 'x', sizeof(maximum));
    close(descriptors[0]);
    int result = write_frame(descriptors[1], maximum, sizeof(maximum), 1000);
    close(descriptors[1]);
    _exit(result == 0 ? 0 : 4);
  }
  close(descriptors[1]);
  if (set_nonblocking(descriptors[0]) != 0 ||
      read_frame(descriptors[0], payload, &payload_length, 1000) != FRAME_OK ||
      payload_length != MAX_PACKET_BYTES) {
    close(descriptors[0]);
    return self_test_failure("16KiB payload boundary");
  }
  close(descriptors[0]);
  if (waitpid(child, &status, 0) != child || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    return self_test_failure("maximum frame writer");
  }
  return 0;
}

static int protocol_self_test(void) {
  HelperState state = {0};
  const char request[] = "{\"version\":1,\"requestId\":\"same\",\"operation\":\"health\"}";
  const char conflict[] = "{\"version\":1,\"requestId\":\"same\",\"operation\":\"inspect\",\"surfaces\":[]}";
  const char phase0_switch[] = "{\"version\":1,\"requestId\":\"phase0-switch\",\"operation\":\"switch\"}";
  const char phase0_revoke[] = "{\"version\":1,\"requestId\":\"phase0-revoke\",\"operation\":\"revoke\"}";
  const char phase1_switch[] = "{\"version\":1,\"requestId\":\"phase1-switch\",\"operation\":\"switch\"}";
  json_object *first;
  json_object *second;
  json_object *value = NULL;
  json_object *operations = NULL;
  char first_encoded[MAX_PACKET_BYTES + 1];
  snprintf(state.daemon_instance_id, sizeof(state.daemon_instance_id), "self-test");
  first = process_request(&state, request, sizeof(request) - 1, monotonic_ns());
  if (!first || !json_object_object_get_ex(first, "phase", &value) ||
      json_object_get_int(value) != 0 ||
      !json_object_object_get_ex(first, "readOnly", &value) || !json_object_get_boolean(value) ||
      !json_object_object_get_ex(first, "mutationsAllowed", &value) || json_object_get_boolean(value) ||
      !json_object_object_get_ex(first, "supportedOperations", &operations) ||
      !json_object_is_type(operations, json_type_array) ||
      json_object_array_length(operations) != 2 ||
      strcmp(json_object_get_string(json_object_array_get_idx(operations, 0)), "health") != 0 ||
      strcmp(json_object_get_string(json_object_array_get_idx(operations, 1)), "inspect") != 0) {
    if (first) json_object_put(first);
    return self_test_failure("Phase 0 health response");
  }
  snprintf(first_encoded, sizeof(first_encoded), "%s",
           json_object_to_json_string_ext(first, JSON_C_TO_STRING_PLAIN));
  json_object_put(first);
  second = process_request(&state, request, sizeof(request) - 1, monotonic_ns());
  if (!second || strcmp(first_encoded,
      json_object_to_json_string_ext(second, JSON_C_TO_STRING_PLAIN)) != 0) {
    if (second) json_object_put(second);
    return self_test_failure("idempotent replay");
  }
  json_object_put(second);
  second = process_request(&state, conflict, sizeof(conflict) - 1, monotonic_ns());
  if (!second || !json_object_object_get_ex(second, "errorCode", &value) ||
      strcmp(json_object_get_string(value), "REQUEST_ID_CONFLICT") != 0) {
    if (second) json_object_put(second);
    return self_test_failure("requestId conflict");
  }
  json_object_put(second);
  second = process_request(&state, phase0_switch, sizeof(phase0_switch) - 1, monotonic_ns());
  if (!second || !json_object_object_get_ex(second, "errorCode", &value) ||
      strcmp(json_object_get_string(value), "OPERATION_DISABLED_PHASE0") != 0) {
    if (second) json_object_put(second);
    return self_test_failure("Phase 0 switch rejection");
  }
  json_object_put(second);
  second = process_request(&state, phase0_revoke, sizeof(phase0_revoke) - 1, monotonic_ns());
  if (!second || !json_object_object_get_ex(second, "errorCode", &value) ||
      strcmp(json_object_get_string(value), "OPERATION_DISABLED_PHASE0") != 0) {
    if (second) json_object_put(second);
    return self_test_failure("Phase 0 revoke rejection");
  }
  json_object_put(second);
  state.phase = 1;
  second = process_request(&state, phase1_switch, sizeof(phase1_switch) - 1, monotonic_ns());
  if (!second || !json_object_object_get_ex(second, "errorCode", &value) ||
      strcmp(json_object_get_string(value), "INVALID_SWITCH_REQUEST") != 0) {
    if (second) json_object_put(second);
    return self_test_failure("Phase 1 switch validation");
  }
  json_object_put(second);
  return 0;
}

static int guard_pause_self_test(void) {
  HelperState state = {0};
  char directory[] = "/tmp/tikpal-x11-guard-pause.XXXXXX";
  char generation_path[PATH_MAX];
  char marker_path[PATH_MAX];
  const char paused_request[] =
    "{\"version\":1,\"requestId\":\"guard-paused\",\"operation\":\"inspect\","
    "\"callerRole\":\"window_guard\",\"surfaces\":[]}";
  json_object *response = NULL;
  json_object *value = NULL;
  bool passed = false;
  if (!mkdtemp(directory) ||
      snprintf(generation_path, sizeof(generation_path), "%s/generation", directory) < 0 ||
      snprintf(marker_path, sizeof(marker_path), "%s/provider-switch.pid", directory) < 0) {
    return self_test_failure("Guard pause fixture path");
  }
  FILE *marker = fopen(marker_path, "we");
  if (!marker) {
    unlink(marker_path);
    rmdir(directory);
    return self_test_failure("Guard pause fixture marker");
  }
  int marker_write_result = fprintf(marker, "%ld\n", (long)getpid());
  int marker_close_result = fclose(marker);
  if (marker_write_result < 0 || marker_close_result != 0) {
    unlink(marker_path);
    rmdir(directory);
    return self_test_failure("Guard pause fixture marker");
  }
  snprintf(state.daemon_instance_id, sizeof(state.daemon_instance_id), "self-test");
  snprintf(state.generation_path, sizeof(state.generation_path), "%s", generation_path);
  response = process_request(&state, paused_request, sizeof(paused_request) - 1, monotonic_ns());
  if (response && json_object_object_get_ex(response, "errorCode", &value) &&
      strcmp(json_object_get_string(value), "GUARD_PAUSED_FOR_SWITCH") == 0 &&
      state.guard_paused_requests == 1 && state.inspect_requests == 0 &&
      state.inspect_failures == 0) {
    passed = true;
  }
  if (response) json_object_put(response);
  unlink(marker_path);
  rmdir(directory);
  return passed ? 0 : self_test_failure("Guard inspection pause");
}

static int command_line_self_test(void) {
  const char equals_form[] = "chromium\0--user-data-dir=/tmp/tikpal-profile\0";
  const char separate_form[] = "chromium\0--user-data-dir\0/tmp/tikpal-profile\0";
  const char rewritten_form[] = "chromium --app=https://example.test --user-data-dir=/tmp/tikpal-profile --kiosk\0";
  const char rewritten_separate_form[] = "chromium --app=https://example.test --user-data-dir /tmp/tikpal-profile --kiosk\0";
  const char wrong_form[] = "chromium\0--user-data-dir=/tmp/tikpal-profile-other\0";
  if (!command_line_matches_profile(equals_form, sizeof(equals_form) - 1,
                                    "/tmp/tikpal-profile", "") ||
      !command_line_matches_profile(separate_form, sizeof(separate_form) - 1,
                                    "/tmp/tikpal-profile", "") ||
      !command_line_matches_profile(rewritten_form, sizeof(rewritten_form) - 1,
                                    "/tmp/tikpal-profile", "") ||
      !command_line_matches_profile(rewritten_separate_form, sizeof(rewritten_separate_form) - 1,
                                    "/tmp/tikpal-profile", "") ||
      command_line_matches_profile(wrong_form, sizeof(wrong_form) - 1,
                                   "/tmp/tikpal-profile", "")) {
    return self_test_failure("NUL-delimited Chromium profile parsing");
  }
  return 0;
}

static int owner_file_self_test(void) {
  char path[] = "/tmp/tikpal-x11-owner.XXXXXX";
  char generation_path[] = "/tmp/tikpal-x11-owner-generation.XXXXXX";
  int descriptor = mkstemp(path);
  int generation_descriptor = mkstemp(generation_path);
  const char helper_owner[] =
    "{\"owner\":\"helper\",\"generation\":1,\"surfaces\":[{\"role\":\"target\",\"xid\":2}]}";
  const char shell_owner[] = "{\"owner\":\"shell\",\"generation\":1,\"surfaces\":[]}";
  const char generation[] = "1\n";
  char *blocked[] = {"client", "owner-allows", "--file", path,
                     "--generation-file", generation_path, "--xid", "2"};
  char *allowed[] = {"client", "owner-allows", "--file", path,
                     "--generation-file", generation_path, "--xid", "3"};
  char *all[] = {"client", "owner-allows", "--file", path,
                 "--generation-file", generation_path, "--all"};
  if (descriptor < 0 || generation_descriptor < 0 ||
      write(descriptor, helper_owner, sizeof(helper_owner) - 1) !=
        (ssize_t)(sizeof(helper_owner) - 1) ||
      write(generation_descriptor, generation, sizeof(generation) - 1) !=
        (ssize_t)(sizeof(generation) - 1) ||
      close(descriptor) != 0 || close(generation_descriptor) != 0) {
    if (descriptor >= 0) close(descriptor);
    if (generation_descriptor >= 0) close(generation_descriptor);
    unlink(path);
    unlink(generation_path);
    return self_test_failure("owner fixture write");
  }
  if (run_owner_allows(8, blocked) != 24 || run_owner_allows(8, allowed) != 0 ||
      run_owner_allows(7, all) != 24) {
    unlink(path);
    unlink(generation_path);
    return self_test_failure("owner exact surface arbitration");
  }
  descriptor = open(path, O_WRONLY | O_TRUNC | O_CLOEXEC);
  if (descriptor < 0 || write(descriptor, shell_owner, sizeof(shell_owner) - 1) !=
      (ssize_t)(sizeof(shell_owner) - 1) || close(descriptor) != 0 ||
      run_owner_allows(7, all) != 0) {
    if (descriptor >= 0) close(descriptor);
    unlink(path);
    unlink(generation_path);
    return self_test_failure("owner all-surface arbitration");
  }
  descriptor = open(path, O_WRONLY | O_TRUNC | O_CLOEXEC);
  if (descriptor < 0 || write(descriptor, "{", 1) != 1 || close(descriptor) != 0 ||
      run_owner_allows(8, allowed) != 24) {
    if (descriptor >= 0) close(descriptor);
    unlink(path);
    unlink(generation_path);
    return self_test_failure("malformed owner fail closed");
  }
  unlink(path);
  unlink(generation_path);
  return 0;
}

#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
static xcb_connection_t *self_test_hook_connection = NULL;
static xcb_window_t self_test_hook_window = XCB_WINDOW_NONE;
static xcb_atom_t self_test_hook_pid_atom = XCB_ATOM_NONE;
static bool self_test_hook_failed = false;

static void x11_self_test_destroy_before_mutation(void) {
  HelperState hook_state = {.connection = self_test_hook_connection};
  PendingReply pending = {0};
  AsyncError async_error = {0};
  if (!self_test_hook_connection || self_test_hook_window == XCB_WINDOW_NONE) {
    self_test_hook_failed = true;
    return;
  }
  xcb_destroy_window(self_test_hook_connection, self_test_hook_window);
  xcb_get_input_focus_cookie_t fence = xcb_get_input_focus(self_test_hook_connection);
  pending.sequence = fence.sequence;
  if (xcb_flush(self_test_hook_connection) <= 0 ||
      collect_replies(&hook_state, &pending, 1,
                      monotonic_ns() + 1000000000LL, &async_error) != 0 ||
      async_error.seen || pending.error || !pending.reply) {
    self_test_hook_failed = true;
  }
  free_pending(&pending, 1);
  self_test_hook_window = XCB_WINDOW_NONE;
}

static void x11_self_test_move_before_final_query(void) {
  HelperState hook_state = {.connection = self_test_hook_connection};
  PendingReply pending = {0};
  AsyncError async_error = {0};
  uint32_t values[2] = {400, 30};
  if (!self_test_hook_connection || self_test_hook_window == XCB_WINDOW_NONE) {
    self_test_hook_failed = true;
    return;
  }
  xcb_configure_window(self_test_hook_connection, self_test_hook_window,
                       XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y, values);
  xcb_get_input_focus_cookie_t fence = xcb_get_input_focus(self_test_hook_connection);
  pending.sequence = fence.sequence;
  if (xcb_flush(self_test_hook_connection) <= 0 ||
      collect_replies(&hook_state, &pending, 1,
                      monotonic_ns() + 1000000000LL, &async_error) != 0 ||
      async_error.seen || pending.error || !pending.reply) {
    self_test_hook_failed = true;
  }
  free_pending(&pending, 1);
}

static void x11_self_test_change_pid_before_final_query(void) {
  HelperState hook_state = {.connection = self_test_hook_connection};
  PendingReply pending = {0};
  AsyncError async_error = {0};
  uint32_t replacement_pid = (uint32_t)getpid() + 1;
  if (!self_test_hook_connection || self_test_hook_window == XCB_WINDOW_NONE ||
      self_test_hook_pid_atom == XCB_ATOM_NONE) {
    self_test_hook_failed = true;
    return;
  }
  xcb_change_property(self_test_hook_connection, XCB_PROP_MODE_REPLACE, self_test_hook_window,
                      self_test_hook_pid_atom, XCB_ATOM_CARDINAL, 32, 1, &replacement_pid);
  xcb_get_input_focus_cookie_t fence = xcb_get_input_focus(self_test_hook_connection);
  pending.sequence = fence.sequence;
  if (xcb_flush(self_test_hook_connection) <= 0 ||
      collect_replies(&hook_state, &pending, 1,
                      monotonic_ns() + 1000000000LL, &async_error) != 0 ||
      async_error.seen || pending.error || !pending.reply) {
    self_test_hook_failed = true;
  }
  free_pending(&pending, 1);
}
#endif

static xcb_window_t create_x11_self_test_window(xcb_connection_t *connection,
                                                xcb_screen_t *screen,
                                                xcb_window_t parent,
                                                xcb_atom_t pid_atom,
                                                xcb_atom_t opacity_atom,
                                                int16_t x, int16_t y,
                                                uint16_t width, uint16_t height,
                                                uint16_t border_width,
                                                bool opacity_present,
                                                uint32_t opacity) {
  static const char wm_class[] = "chromium\0Chromium";
  uint32_t background = screen->black_pixel;
  uint32_t pid = (uint32_t)getpid();
  xcb_window_t window = xcb_generate_id(connection);
  xcb_create_window(connection, XCB_COPY_FROM_PARENT, window, parent,
                    x, y, width, height, border_width, XCB_WINDOW_CLASS_INPUT_OUTPUT,
                    screen->root_visual, XCB_CW_BACK_PIXEL, &background);
  xcb_change_property(connection, XCB_PROP_MODE_REPLACE, window, pid_atom,
                      XCB_ATOM_CARDINAL, 32, 1, &pid);
  xcb_change_property(connection, XCB_PROP_MODE_REPLACE, window, XCB_ATOM_WM_CLASS,
                      XCB_ATOM_STRING, 8, sizeof(wm_class), wm_class);
  if (opacity_present) {
    xcb_change_property(connection, XCB_PROP_MODE_REPLACE, window, opacity_atom,
                        XCB_ATOM_CARDINAL, 32, 1, &opacity);
  }
  xcb_map_window(connection, window);
  return window;
}

static json_object *x11_self_test_surface(const char *role, xcb_window_t xid,
                                          const char *profile, int32_t x, int32_t y,
                                          uint32_t width, uint32_t height,
                                          bool has_target_opacity,
                                          uint32_t target_opacity) {
  json_object *surface = json_object_new_object();
  json_object *geometry = json_object_new_object();
  json_object_object_add(surface, "role", json_object_new_string(role));
  json_object_object_add(surface, "xid", json_object_new_int64(xid));
  json_object_object_add(surface, "profile", json_object_new_string(profile));
  json_object_object_add(geometry, "x", json_object_new_int(x));
  json_object_object_add(geometry, "y", json_object_new_int(y));
  json_object_object_add(geometry, "width", json_object_new_int64(width));
  json_object_object_add(geometry, "height", json_object_new_int64(height));
  json_object_object_add(surface, "geometry", geometry);
  if (has_target_opacity) {
    json_object_object_add(surface, "targetOpacity", json_object_new_int64(target_opacity));
  }
  return surface;
}

static json_object *x11_self_test_switch_request(const HelperState *state,
                                                 const char *request_id,
                                                 uint64_t generation,
                                                 xcb_window_t target,
                                                 xcb_window_t previous,
                                                 xcb_window_t panel,
                                                 const char *profile) {
  json_object *request = json_object_new_object();
  json_object *surfaces = json_object_new_array();
  char lease_id[80];
  snprintf(lease_id, sizeof(lease_id), "%s-lease", request_id);
  json_object_object_add(request, "version", json_object_new_int(1));
  json_object_object_add(request, "requestId", json_object_new_string(request_id));
  json_object_object_add(request, "operation", json_object_new_string("switch"));
  json_object_object_add(request, "daemonInstanceId",
                         json_object_new_string(state->daemon_instance_id));
  json_object_object_add(request, "connectionEpoch",
                         json_object_new_int64((int64_t)state->connection_epoch));
  json_object_object_add(request, "generation", json_object_new_int64((int64_t)generation));
  json_object_object_add(request, "leaseId", json_object_new_string(lease_id));
  json_object_object_add(request, "leaseDurationMs",
                         json_object_new_int64(SELF_TEST_LEASE_DURATION_MS));
  json_object_array_add(surfaces, x11_self_test_surface("target", target, profile,
                                                       0, 0, 1920, 720, true, UINT32_MAX));
  json_object_array_add(surfaces, x11_self_test_surface("previous", previous, profile,
                                                       2560, 0, 1920, 720, false, 0));
  json_object_array_add(surfaces, x11_self_test_surface("panel", panel, profile,
                                                       1920, 0, 640, 720, true, UINT32_MAX));
  json_object_object_add(request, "surfaces", surfaces);
  return request;
}

static json_object *x11_self_test_watch_request(const HelperState *state,
                                                const char *request_id,
                                                uint64_t generation,
                                                xcb_window_t xid) {
  json_object *request = json_object_new_object();
  json_object *surfaces = json_object_new_array();
  json_object *surface = json_object_new_object();
  json_object_object_add(request, "version", json_object_new_int(1));
  json_object_object_add(request, "requestId", json_object_new_string(request_id));
  json_object_object_add(request, "operation", json_object_new_string("watch"));
  json_object_object_add(request, "daemonInstanceId",
                         json_object_new_string(state->daemon_instance_id));
  json_object_object_add(request, "connectionEpoch",
                         json_object_new_int64((int64_t)state->connection_epoch));
  json_object_object_add(request, "generation", json_object_new_int64((int64_t)generation));
  json_object_object_add(request, "leaseId", json_object_new_string("watch-self-test-lease"));
  json_object_object_add(request, "leaseDurationMs", json_object_new_int(1000));
  json_object_object_add(surface, "role", json_object_new_string("provider"));
  json_object_object_add(surface, "xid", json_object_new_int64((int64_t)xid));
  json_object_array_add(surfaces, surface);
  json_object_object_add(request, "surfaces", surfaces);
  return request;
}

static json_object *x11_self_test_watch_lease_request(const HelperState *state,
                                                      const char *request_id,
                                                      const char *operation,
                                                      uint64_t generation) {
  json_object *request = json_object_new_object();
  json_object_object_add(request, "version", json_object_new_int(1));
  json_object_object_add(request, "requestId", json_object_new_string(request_id));
  json_object_object_add(request, "operation", json_object_new_string(operation));
  json_object_object_add(request, "daemonInstanceId",
                         json_object_new_string(state->daemon_instance_id));
  json_object_object_add(request, "connectionEpoch",
                         json_object_new_int64((int64_t)state->connection_epoch));
  json_object_object_add(request, "generation", json_object_new_int64((int64_t)generation));
  json_object_object_add(request, "leaseId", json_object_new_string("watch-self-test-lease"));
  if (strcmp(operation, "renew-watch") == 0) {
    json_object_object_add(request, "leaseDurationMs", json_object_new_int(1000));
  }
  return request;
}

static bool x11_self_test_publish_generation(const char *path, uint64_t generation) {
  char value[32];
  int length = snprintf(value, sizeof(value), "%" PRIu64 "\n", generation);
  int descriptor = open(path, O_WRONLY | O_TRUNC | O_CLOEXEC);
  bool ok = descriptor >= 0 && length > 0 && (size_t)length < sizeof(value) &&
            write(descriptor, value, (size_t)length) == length;
  if (descriptor >= 0 && close(descriptor) != 0) ok = false;
  return ok;
}

static bool x11_self_test_fence(xcb_connection_t *connection) {
  xcb_generic_error_t *error = NULL;
  xcb_get_input_focus_reply_t *reply = xcb_get_input_focus_reply(
    connection, xcb_get_input_focus(connection), &error);
  bool ok = reply && !error;
  free(reply);
  free(error);
  return ok;
}

static bool x11_self_test_pump_watch(HelperState *state, int64_t deadline_ns) {
  bool saw_event = false;
  while (remaining_timeout_ms(deadline_ns) > 0) {
    xcb_generic_event_t *event;
    bool progressed = false;
    while ((event = xcb_poll_for_event(state->connection)) != NULL) {
      progressed = true;
      saw_event = true;
      if ((event->response_type & 0x7fU) == 0) {
        invalidate_watch(state, "XCB_ASYNC_ERROR");
      } else {
        observe_xcb_event(state, event);
      }
      free(event);
    }
    if (!state->watch_valid || progressed) {
      if (!state->watch_valid) return true;
      continue;
    }
    struct pollfd descriptor = {
      .fd = xcb_get_file_descriptor(state->connection), .events = POLLIN | POLLERR | POLLHUP
    };
    int timeout_ms = remaining_timeout_ms(deadline_ns);
    int poll_result = poll(&descriptor, 1, timeout_ms > 20 ? 20 : timeout_ms);
    if (poll_result < 0 && errno != EINTR) return false;
    if (poll_result > 0 && (descriptor.revents & (POLLERR | POLLHUP | POLLNVAL))) return false;
    if (poll_result == 0 && saw_event) return true;
  }
  return true;
}

static int x11_watch_self_test(const char *display) {
  HelperState state = {.phase = 3, .transaction_timeout_ms = SELF_TEST_TRANSACTION_TIMEOUT_MS};
  xcb_connection_t *fixture_connection = NULL;
  xcb_screen_t *fixture_screen = NULL;
  xcb_window_t watched = XCB_WINDOW_NONE;
  char generation_path[] = "/tmp/tikpal-x11-watch-generation.XXXXXX";
  int generation_descriptor = -1;
  json_object *request = NULL;
  json_object *response = NULL;
  json_object *value = NULL;
  uint64_t reported_before_unwatch;
  uint64_t stale_before;
  int result = 1;

  generation_descriptor = mkstemp(generation_path);
  if (generation_descriptor < 0 || write(generation_descriptor, "1\n", 2) != 2 ||
      close(generation_descriptor) != 0) {
    if (generation_descriptor >= 0) close(generation_descriptor);
    return self_test_failure("X11 watch generation fixture");
  }
  generation_descriptor = -1;
  snprintf(state.display, sizeof(state.display), "%s", display);
  snprintf(state.generation_path, sizeof(state.generation_path), "%s", generation_path);
  snprintf(state.daemon_instance_id, sizeof(state.daemon_instance_id), "watch-self-test");
  load_generation_floor(&state);
  if (state.generation_state != GENERATION_OK ||
      connect_xcb(&state, false, monotonic_ns() + 1000000000LL) != 0) {
    self_test_failure("X11 watch helper connection");
    goto cleanup;
  }
  fixture_connection = xcb_connect(display, NULL);
  if (!fixture_connection || xcb_connection_has_error(fixture_connection) != 0) {
    self_test_failure("X11 watch fixture connection");
    goto cleanup;
  }
  fixture_screen = screen_for_number(fixture_connection, 0);
  if (!fixture_screen) {
    self_test_failure("X11 watch fixture screen");
    goto cleanup;
  }
  watched = create_x11_self_test_window(fixture_connection, fixture_screen, fixture_screen->root,
                                        state.net_wm_pid, state.net_wm_opacity,
                                        40, 40, 1200, 600, 0, true, UINT32_MAX);
  if (xcb_flush(fixture_connection) <= 0 || !x11_self_test_fence(fixture_connection)) {
    self_test_failure("X11 watch fixture map");
    goto cleanup;
  }
  request = x11_self_test_watch_request(&state, "watch-start", 1, watched);
  response = watch_response(&state, request, "watch-start", monotonic_ns());
  if (!response || !json_object_object_get_ex(response, "ok", &value) ||
      !json_object_get_boolean(value) || !state.watch_valid || state.mutation_requests != 0 ||
      state.mutation_started) {
    self_test_failure("X11 watch subscription");
    goto cleanup;
  }
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;

  uint32_t geometry[] = {80, 40};
  uint32_t opacity = 0xffffff00U;
  const char title[] = "unmanaged";
  xcb_configure_window(fixture_connection, watched,
                       XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y, geometry);
  xcb_change_property(fixture_connection, XCB_PROP_MODE_REPLACE, watched, state.net_wm_opacity,
                      XCB_ATOM_CARDINAL, 32, 1, &opacity);
  xcb_change_property(fixture_connection, XCB_PROP_MODE_REPLACE, watched, XCB_ATOM_WM_NAME,
                      XCB_ATOM_STRING, 8, sizeof(title) - 1, title);
  if (xcb_flush(fixture_connection) <= 0 || !x11_self_test_fence(fixture_connection) ||
      !x11_self_test_pump_watch(&state, monotonic_ns() + 1000000000LL)) {
    self_test_failure("X11 watch event pump");
    goto cleanup;
  }
  bool saw_configure = false;
  bool saw_property = false;
  for (size_t index = 0; index < state.watch_event_history_count; index++) {
    const WatchEvent *event = &state.watch_event_history[index];
    if (strcmp(event->type, "ConfigureNotify") == 0) saw_configure = true;
    if (strcmp(event->type, "PropertyNotify") == 0 && event->property == state.net_wm_opacity) {
      saw_property = true;
    }
  }
  if (!saw_configure || !saw_property || state.watch_events_would_repair < 2 ||
      state.watch_events_unrelated_dropped == 0 || state.mutation_requests != 0 ||
      state.mutation_started) {
    self_test_failure("X11 watch would-repair classification");
    goto cleanup;
  }

  request = x11_self_test_watch_lease_request(&state, "watch-renew", "renew-watch", 1);
  response = renew_watch_response(&state, request, "watch-renew");
  if (!response || !json_object_object_get_ex(response, "code", &value) ||
      strcmp(json_object_get_string(value), "WATCH_RENEWED") != 0 || !state.watch_valid) {
    self_test_failure("X11 watch lease renew");
    goto cleanup;
  }
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;

  stale_before = state.watch_events_stale_dropped;
  if (!x11_self_test_publish_generation(generation_path, 2)) {
    self_test_failure("X11 watch generation advance");
    goto cleanup;
  }
  geometry[0] = 120;
  xcb_configure_window(fixture_connection, watched,
                       XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y, geometry);
  if (xcb_flush(fixture_connection) <= 0 || !x11_self_test_fence(fixture_connection) ||
      !x11_self_test_pump_watch(&state, monotonic_ns() + 1000000000LL) || state.watch_valid ||
      strcmp(state.watch_invalid_reason, "GENERATION_ADVANCED") != 0 ||
      state.watch_events_stale_dropped <= stale_before) {
    self_test_failure("X11 watch stale generation discard");
    goto cleanup;
  }

  request = x11_self_test_watch_lease_request(&state, "watch-stop", "unwatch", 1);
  response = unwatch_response(&state, request, "watch-stop", "unwatch", "UNWATCHED");
  if (!response || !json_object_object_get_ex(response, "code", &value) ||
      strcmp(json_object_get_string(value), "UNWATCHED") != 0 || state.watch_valid ||
      state.watch_lease_id[0] || state.mutation_requests != 0) {
    self_test_failure("X11 watch release");
    goto cleanup;
  }
  reported_before_unwatch = state.watch_events_reported;
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;
  xcb_change_property(fixture_connection, XCB_PROP_MODE_REPLACE, watched, state.net_wm_opacity,
                      XCB_ATOM_CARDINAL, 32, 1, &opacity);
  if (xcb_flush(fixture_connection) <= 0 || !x11_self_test_fence(fixture_connection) ||
      !x11_self_test_pump_watch(&state, monotonic_ns() + 100000000LL) ||
      state.watch_events_reported != reported_before_unwatch || state.mutation_requests != 0) {
    self_test_failure("X11 watch unwatch no-repair");
    goto cleanup;
  }
  result = 0;

cleanup:
  if (response) json_object_put(response);
  if (request) json_object_put(request);
  if (fixture_connection) {
    if (watched != XCB_WINDOW_NONE) xcb_destroy_window(fixture_connection, watched);
    xcb_flush(fixture_connection);
    xcb_disconnect(fixture_connection);
  }
  if (state.connection) xcb_disconnect(state.connection);
  unlink(generation_path);
  return result;
}

static size_t x11_self_test_mutation_count(json_object *response, const char *action) {
  json_object *mutations = NULL;
  size_t count = 0;
  if (!json_object_object_get_ex(response, "mutations", &mutations) ||
      !json_object_is_type(mutations, json_type_array)) return SIZE_MAX;
  if (!action) return json_object_array_length(mutations);
  for (size_t index = 0; index < json_object_array_length(mutations); index++) {
    json_object *mutation = json_object_array_get_idx(mutations, index);
    json_object *value = NULL;
    if (json_object_object_get_ex(mutation, "action", &value) &&
        json_object_is_type(value, json_type_string) &&
        strcmp(json_object_get_string(value), action) == 0) count++;
  }
  return count;
}

static bool x11_self_test_mutations_ok(json_object *response) {
  json_object *mutations = NULL;
  if (!json_object_object_get_ex(response, "mutations", &mutations) ||
      !json_object_is_type(mutations, json_type_array)) return false;
  for (size_t index = 0; index < json_object_array_length(mutations); index++) {
    json_object *mutation = json_object_array_get_idx(mutations, index);
    json_object *value = NULL;
    if (!json_object_object_get_ex(mutation, "checked", &value) ||
        !json_object_get_boolean(value) ||
        !json_object_object_get_ex(mutation, "ok", &value) ||
        !json_object_get_boolean(value)) return false;
  }
  return true;
}

static int lease_arbitration_self_test(void) {
  HelperState state = {0};
  char generation_path[] = "/tmp/tikpal-x11-lease-generation.XXXXXX";
  int descriptor = mkstemp(generation_path);
  json_object *request = NULL;
  json_object *response = NULL;
  json_object *value = NULL;
  if (descriptor < 0 || write(descriptor, "10\n", 3) != 3 || close(descriptor) != 0) {
    if (descriptor >= 0) close(descriptor);
    unlink(generation_path);
    return self_test_failure("lease generation fixture");
  }
  snprintf(state.daemon_instance_id, sizeof(state.daemon_instance_id), "lease-self-test");
  snprintf(state.generation_path, sizeof(state.generation_path), "%s", generation_path);
  state.connection = (xcb_connection_t *)(uintptr_t)1;
  state.screen = (xcb_screen_t *)(uintptr_t)1;
  state.connection_epoch = 5;
  state.transaction_timeout_ms = DEFAULT_TRANSACTION_TIMEOUT_MS;
  state.lease_active = true;
  state.lease_generation = 10;
  state.lease_epoch = 5;
  state.lease_expires_ns = monotonic_ns() + 1000000000LL;
  snprintf(state.lease_id, sizeof(state.lease_id), "existing-lease");
  request = x11_self_test_switch_request(&state, "lease-conflict", 10,
                                         101, 202, 303, "/tmp/lease-profile");
  json_object_object_add(request, "leaseId", json_object_new_string("different-lease"));
  response = switch_response(&state, request, "lease-conflict", monotonic_ns());
  if (!response || !json_object_object_get_ex(response, "code", &value) ||
      strcmp(json_object_get_string(value), "LEASE_CONFLICT") != 0 ||
      !state.lease_active || strcmp(state.lease_id, "existing-lease") != 0) {
    if (response) json_object_put(response);
    json_object_put(request);
    unlink(generation_path);
    return self_test_failure("same-generation lease conflict");
  }
  json_object_put(response);
  response = NULL;

  state.in_flight = true;
  response = switch_response(&state, request, "lease-busy", monotonic_ns());
  if (!response || !json_object_object_get_ex(response, "code", &value) ||
      strcmp(json_object_get_string(value), "BUSY") != 0 || !state.in_flight) {
    if (response) json_object_put(response);
    json_object_put(request);
    unlink(generation_path);
    return self_test_failure("single in-flight switch");
  }
  json_object_put(response);
  response = NULL;
  state.in_flight = false;

  json_object_object_add(request, "connectionEpoch", json_object_new_int64(4));
  response = switch_response(&state, request, "lease-old-epoch", monotonic_ns());
  if (!response || !json_object_object_get_ex(response, "code", &value) ||
      strcmp(json_object_get_string(value), "CONNECTION_EPOCH_MISMATCH") != 0 ||
      !state.lease_active) {
    if (response) json_object_put(response);
    json_object_put(request);
    unlink(generation_path);
    return self_test_failure("old lease epoch rejection");
  }
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = json_object_new_object();
  json_object_object_add(request, "daemonInstanceId",
                         json_object_new_string(state.daemon_instance_id));
  json_object_object_add(request, "connectionEpoch", json_object_new_int64(5));
  json_object_object_add(request, "generation", json_object_new_int64(10));
  json_object_object_add(request, "leaseId", json_object_new_string("existing-lease"));
  state.in_flight = true;
  state.mutation_started = true;
  response = revoke_response(&state, request, "revoke-busy");
  if (!response || !json_object_object_get_ex(response, "code", &value) ||
      strcmp(json_object_get_string(value), "BUSY") != 0 ||
      !state.lease_active || !state.mutation_started) {
    if (response) json_object_put(response);
    json_object_put(request);
    unlink(generation_path);
    return self_test_failure("revoke before in-flight completion");
  }
  json_object_put(response);
  response = NULL;
  state.in_flight = false;
  response = revoke_response(&state, request, "revoke-complete");
  if (!response || !json_object_object_get_ex(response, "code", &value) ||
      strcmp(json_object_get_string(value), "REVOKED") != 0 ||
      state.lease_active || state.mutation_started) {
    if (response) json_object_put(response);
    json_object_put(request);
    unlink(generation_path);
    return self_test_failure("revoke after in-flight completion");
  }
  json_object_put(response);
  json_object_put(request);
  unlink(generation_path);
  state.connection = NULL;
  state.screen = NULL;
  return 0;
}

static json_object *x11_self_test_response_surface(json_object *response, const char *role) {
  json_object *surfaces = NULL;
  if (!json_object_object_get_ex(response, "surfaces", &surfaces) ||
      !json_object_is_type(surfaces, json_type_array)) return NULL;
  for (size_t index = 0; index < json_object_array_length(surfaces); index++) {
    json_object *surface = json_object_array_get_idx(surfaces, index);
    json_object *value = NULL;
    if (surface && json_object_object_get_ex(surface, "role", &value) &&
        json_object_is_type(value, json_type_string) &&
        strcmp(json_object_get_string(value), role) == 0) return surface;
  }
  return NULL;
}

static bool x11_self_test_surface_matches(json_object *response, const char *role,
                                          int32_t x, int32_t y,
                                          uint32_t width, uint32_t height,
                                          bool opacity_present, uint32_t opacity) {
  json_object *surface = x11_self_test_response_surface(response, role);
  json_object *geometry = NULL;
  json_object *opacity_value = NULL;
  json_object *value = NULL;
  if (!surface || !json_object_object_get_ex(surface, "geometry", &geometry) ||
      !json_object_object_get_ex(surface, "opacity", &opacity_value)) return false;
  if (!json_object_object_get_ex(geometry, "x", &value) || json_object_get_int(value) != x ||
      !json_object_object_get_ex(geometry, "y", &value) || json_object_get_int(value) != y ||
      !json_object_object_get_ex(geometry, "width", &value) ||
      json_object_get_int64(value) != width ||
      !json_object_object_get_ex(geometry, "height", &value) ||
      json_object_get_int64(value) != height) return false;
  if (!json_object_object_get_ex(opacity_value, "present", &value) ||
      json_object_get_boolean(value) != opacity_present ||
      !json_object_object_get_ex(opacity_value, "value", &value) ||
      (uint64_t)json_object_get_int64(value) != opacity) return false;
  return true;
}

static int x11_transaction_self_test(const char *display, const char *profile,
                                     pid_t xserver_pid) {
#ifndef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  (void)xserver_pid;
#endif
  HelperState state = {0};
  HelperState fixture_state = {0};
  PendingReply fixture_fence = {0};
  PendingReply stack_pending = {0};
  AsyncError fixture_error = {0};
  xcb_connection_t *fixture_connection = NULL;
  xcb_screen_t *fixture_screen = NULL;
  xcb_window_t target = XCB_WINDOW_NONE;
  xcb_window_t previous = XCB_WINDOW_NONE;
  xcb_window_t panel = XCB_WINDOW_NONE;
  xcb_window_t nested_parent = XCB_WINDOW_NONE;
  xcb_window_t nested_target = XCB_WINDOW_NONE;
  xcb_window_t nested_previous = XCB_WINDOW_NONE;
  xcb_window_t nested_panel = XCB_WINDOW_NONE;
  xcb_window_t badwindow_target = XCB_WINDOW_NONE;
  char generation_path[] = "/tmp/tikpal-x11-generation.XXXXXX";
  int generation_descriptor = -1;
  int screen_number = 0;
  int result = 1;
  json_object *request = NULL;
  json_object *surfaces = NULL;
  json_object *response = NULL;
  json_object *value = NULL;
  xcb_query_tree_reply_t *tree = NULL;

  generation_descriptor = mkstemp(generation_path);
  if (generation_descriptor < 0 || write(generation_descriptor, "1\n", 2) != 2 ||
      close(generation_descriptor) != 0) {
    if (generation_descriptor >= 0) close(generation_descriptor);
    return self_test_failure("X11 transaction generation fixture");
  }
  generation_descriptor = -1;
  snprintf(state.display, sizeof(state.display), "%s", display);
  snprintf(state.generation_path, sizeof(state.generation_path), "%s", generation_path);
  snprintf(state.daemon_instance_id, sizeof(state.daemon_instance_id), "x11-self-test");
  state.transaction_timeout_ms = SELF_TEST_TRANSACTION_TIMEOUT_MS;
  load_generation_floor(&state);
  if (state.generation_state != GENERATION_OK ||
      connect_xcb(&state, false, monotonic_ns() + 1000000000LL) != 0) {
    self_test_failure("X11 transaction helper connection");
    goto cleanup;
  }

  fixture_connection = xcb_connect(display, &screen_number);
  if (!fixture_connection || xcb_connection_has_error(fixture_connection) != 0) {
    self_test_failure("X11 transaction fixture connection");
    goto cleanup;
  }
  fixture_screen = screen_for_number(fixture_connection, screen_number);
  if (!fixture_screen) {
    self_test_failure("X11 transaction fixture screen");
    goto cleanup;
  }
  fixture_state.connection = fixture_connection;
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  self_test_identity_pid = (uint32_t)getpid();
  self_test_identity_profile = profile;
#endif
  target = create_x11_self_test_window(fixture_connection, fixture_screen, fixture_screen->root,
                                       state.net_wm_pid, state.net_wm_opacity,
                                       500, 40, 1200, 600, 0, true, 0);
  previous = create_x11_self_test_window(fixture_connection, fixture_screen, fixture_screen->root,
                                         state.net_wm_pid, state.net_wm_opacity,
                                         20, 40, 1200, 600, 0, false, 0);
  panel = create_x11_self_test_window(fixture_connection, fixture_screen, fixture_screen->root,
                                      state.net_wm_pid, state.net_wm_opacity,
                                      1500, 40, 600, 600, 0, true, 0x7fffffffU);
  xcb_get_input_focus_cookie_t map_fence = xcb_get_input_focus(fixture_connection);
  fixture_fence.sequence = map_fence.sequence;
  if (xcb_flush(fixture_connection) <= 0 ||
      collect_replies(&fixture_state, &fixture_fence, 1,
                      monotonic_ns() + 1000000000LL, &fixture_error) != 0 ||
      fixture_error.seen || fixture_fence.error || !fixture_fence.reply) {
    self_test_failure("X11 transaction fixture map fence");
    goto cleanup;
  }
  free_pending(&fixture_fence, 1);
  memset(&fixture_fence, 0, sizeof(fixture_fence));

  request = json_object_new_object();
  surfaces = json_object_new_array();
  json_object_object_add(request, "version", json_object_new_int(1));
  json_object_object_add(request, "requestId", json_object_new_string("x11-basic"));
  json_object_object_add(request, "operation", json_object_new_string("switch"));
  json_object_object_add(request, "daemonInstanceId",
                         json_object_new_string(state.daemon_instance_id));
  json_object_object_add(request, "connectionEpoch",
                         json_object_new_int64((int64_t)state.connection_epoch));
  json_object_object_add(request, "generation", json_object_new_int64(1));
  json_object_object_add(request, "leaseId", json_object_new_string("x11-basic-lease"));
  json_object_object_add(request, "leaseDurationMs",
                         json_object_new_int64(SELF_TEST_LEASE_DURATION_MS));
  json_object_array_add(surfaces, x11_self_test_surface("target", target, profile,
                                                       0, 0, 1920, 720, true, UINT32_MAX));
  json_object_array_add(surfaces, x11_self_test_surface("previous", previous, profile,
                                                       2560, 0, 1920, 720, false, 0));
  json_object_array_add(surfaces, x11_self_test_surface("panel", panel, profile,
                                                       1920, 0, 640, 720, true, UINT32_MAX));
  json_object_object_add(request, "surfaces", surfaces);
  surfaces = NULL;
  response = switch_response(&state, request, "x11-basic", monotonic_ns());
  if (!response || !json_object_object_get_ex(response, "ok", &value) ||
      !json_object_get_boolean(value)) {
    fprintf(stderr, "self-test X11 transaction response: %s\n",
            response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
    self_test_failure("X11 basic transaction");
    goto cleanup;
  }
  if (!x11_self_test_surface_matches(response, "target", 0, 0, 1920, 720,
                                     true, UINT32_MAX) ||
      !x11_self_test_surface_matches(response, "previous", 2560, 0, 1920, 720,
                                     false, UINT32_MAX) ||
      !x11_self_test_surface_matches(response, "panel", 1920, 0, 640, 720,
                                     true, UINT32_MAX)) {
    self_test_failure("X11 final translated snapshot");
    goto cleanup;
  }
  json_object *mutations = NULL;
  if (!json_object_object_get_ex(response, "mutations", &mutations) ||
      json_object_array_length(mutations) != 7) {
    self_test_failure("X11 checked mutation count");
    goto cleanup;
  }
  for (size_t index = 0; index < json_object_array_length(mutations); index++) {
    json_object *mutation = json_object_array_get_idx(mutations, index);
    if (!json_object_object_get_ex(mutation, "checked", &value) ||
        !json_object_get_boolean(value) ||
        !json_object_object_get_ex(mutation, "ok", &value) ||
        !json_object_get_boolean(value)) {
      self_test_failure("X11 checked mutation completion");
      goto cleanup;
    }
  }
  json_object *timings = NULL;
  if (!json_object_object_get_ex(response, "timings", &timings) ||
      !json_object_object_get_ex(timings, "totalMs", &value) ||
      json_object_get_double(value) < 0.0 || json_object_get_double(value) >= 250.0) {
    self_test_failure("X11 transaction absolute deadline");
    goto cleanup;
  }

  xcb_query_tree_cookie_t stack_cookie = xcb_query_tree(fixture_connection, fixture_screen->root);
  stack_pending.sequence = stack_cookie.sequence;
  if (xcb_flush(fixture_connection) <= 0 ||
      collect_replies(&fixture_state, &stack_pending, 1,
                      monotonic_ns() + 1000000000LL, &fixture_error) != 0 ||
      fixture_error.seen || stack_pending.error || !stack_pending.reply) {
    self_test_failure("X11 stack query");
    goto cleanup;
  }
  tree = stack_pending.reply;
  stack_pending.reply = NULL;
  int child_count = xcb_query_tree_children_length(tree);
  xcb_window_t *children = xcb_query_tree_children(tree);
  if (child_count < 2 || children[child_count - 1] != panel ||
      children[child_count - 2] != target) {
    self_test_failure("X11 target and Panel raise order");
    goto cleanup;
  }

  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;
  release_lease(&state);
  const struct {
    const char *name;
    bool present;
    uint32_t opacity;
    bool invalid;
    bool expected_present;
    size_t expected_opacity_mutations;
  } opacity_cases[] = {
    {.name = "absent", .present = false, .expected_present = false,
     .expected_opacity_mutations = 0},
    {.name = "zero", .present = true, .opacity = 0, .expected_present = true,
     .expected_opacity_mutations = 1},
    {.name = "half", .present = true, .opacity = 0x7fffffffU, .expected_present = true,
     .expected_opacity_mutations = 1},
    {.name = "full", .present = true, .opacity = UINT32_MAX, .expected_present = true,
     .expected_opacity_mutations = 0},
    {.name = "invalid", .present = true, .invalid = true, .expected_present = false,
     .expected_opacity_mutations = 0},
  };
  for (size_t index = 0; index < sizeof(opacity_cases) / sizeof(opacity_cases[0]); index++) {
    char request_id[64];
    uint64_t generation = index + 2;
    if (!opacity_cases[index].present) {
      xcb_delete_property(fixture_connection, panel, state.net_wm_opacity);
    } else if (opacity_cases[index].invalid) {
      const uint8_t invalid_opacity = 0;
      xcb_change_property(fixture_connection, XCB_PROP_MODE_REPLACE, panel,
                          state.net_wm_opacity, XCB_ATOM_STRING, 8, 1, &invalid_opacity);
    } else {
      xcb_change_property(fixture_connection, XCB_PROP_MODE_REPLACE, panel,
                          state.net_wm_opacity, XCB_ATOM_CARDINAL, 32, 1,
                          &opacity_cases[index].opacity);
    }
    fixture_error = (AsyncError){0};
    xcb_get_input_focus_cookie_t property_fence = xcb_get_input_focus(fixture_connection);
    fixture_fence.sequence = property_fence.sequence;
    if (xcb_flush(fixture_connection) <= 0 ||
        collect_replies(&fixture_state, &fixture_fence, 1,
                        monotonic_ns() + 1000000000LL, &fixture_error) != 0 ||
        fixture_error.seen || fixture_fence.error || !fixture_fence.reply) {
      self_test_failure("X11 opacity property fence");
      goto cleanup;
    }
    free_pending(&fixture_fence, 1);
    memset(&fixture_fence, 0, sizeof(fixture_fence));
    if (!x11_self_test_publish_generation(generation_path, generation)) {
      self_test_failure("X11 opacity generation publish");
      goto cleanup;
    }
    snprintf(request_id, sizeof(request_id), "x11-opacity-%s", opacity_cases[index].name);
    request = x11_self_test_switch_request(&state, request_id, generation,
                                           target, previous, panel, profile);
    response = switch_response(&state, request, request_id, monotonic_ns());
    if (opacity_cases[index].invalid) {
      json_object *panel_result = x11_self_test_response_surface(response, "panel");
      json_object *code = NULL;
      json_object *started = NULL;
      if (!response || !json_object_object_get_ex(response, "ok", &value) ||
          json_object_get_boolean(value) ||
          !json_object_object_get_ex(response, "mutationStarted", &started) ||
          json_object_get_boolean(started) ||
          !panel_result || !json_object_object_get_ex(panel_result, "code", &code) ||
          strcmp(json_object_get_string(code), "WINDOW_OPACITY_INVALID") != 0 ||
          x11_self_test_mutation_count(response, "panel_opacity") != 0) {
        self_test_failure("X11 invalid opacity rejection");
        goto cleanup;
      }
    } else if (!response || !json_object_object_get_ex(response, "ok", &value) ||
               !json_object_get_boolean(value) ||
               !x11_self_test_mutations_ok(response) ||
               x11_self_test_mutation_count(response, "panel_opacity") !=
                 opacity_cases[index].expected_opacity_mutations ||
               !x11_self_test_surface_matches(response, "panel", 1920, 0, 640, 720,
                                              opacity_cases[index].expected_present,
                                              UINT32_MAX)) {
      fprintf(stderr, "self-test X11 opacity response: %s\n",
              response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
      self_test_failure("X11 opacity state");
      goto cleanup;
    }
    json_object_put(response);
    response = NULL;
    json_object_put(request);
    request = NULL;
    release_lease(&state);
  }

  uint32_t nested_background = fixture_screen->black_pixel;
  nested_parent = xcb_generate_id(fixture_connection);
  xcb_create_window(fixture_connection, XCB_COPY_FROM_PARENT, nested_parent,
                    fixture_screen->root, 100, 40, 2500, 680, 0,
                    XCB_WINDOW_CLASS_INPUT_OUTPUT, fixture_screen->root_visual,
                    XCB_CW_BACK_PIXEL, &nested_background);
  xcb_map_window(fixture_connection, nested_parent);
  nested_target = create_x11_self_test_window(
    fixture_connection, fixture_screen, nested_parent,
    state.net_wm_pid, state.net_wm_opacity, 400, 30, 1200, 600, 3, true, UINT32_MAX);
  nested_previous = create_x11_self_test_window(
    fixture_connection, fixture_screen, nested_parent,
    state.net_wm_pid, state.net_wm_opacity, 10, 30, 1200, 600, 3, false, 0);
  nested_panel = create_x11_self_test_window(
    fixture_connection, fixture_screen, nested_parent,
    state.net_wm_pid, state.net_wm_opacity, 1400, 30, 600, 600, 3, true, UINT32_MAX);
  fixture_error = (AsyncError){0};
  xcb_get_input_focus_cookie_t nested_fence = xcb_get_input_focus(fixture_connection);
  fixture_fence.sequence = nested_fence.sequence;
  if (xcb_flush(fixture_connection) <= 0 ||
      collect_replies(&fixture_state, &fixture_fence, 1,
                      monotonic_ns() + 1000000000LL, &fixture_error) != 0 ||
      fixture_error.seen || fixture_fence.error || !fixture_fence.reply) {
    self_test_failure("X11 nested-parent map fence");
    goto cleanup;
  }
  free_pending(&fixture_fence, 1);
  memset(&fixture_fence, 0, sizeof(fixture_fence));
  if (!x11_self_test_publish_generation(generation_path, 7)) {
    self_test_failure("X11 nested-parent generation publish");
    goto cleanup;
  }
  request = x11_self_test_switch_request(&state, "x11-nested-parent", 7,
                                         nested_target, nested_previous, nested_panel, profile);
  response = switch_response(&state, request, "x11-nested-parent", monotonic_ns());
  if (!response || !json_object_object_get_ex(response, "ok", &value) ||
      !json_object_get_boolean(value) || !x11_self_test_mutations_ok(response) ||
      !x11_self_test_surface_matches(response, "target", 0, 0, 1920, 720,
                                     true, UINT32_MAX) ||
      !x11_self_test_surface_matches(response, "previous", 2560, 0, 1920, 720,
                                     false, UINT32_MAX) ||
      !x11_self_test_surface_matches(response, "panel", 1920, 0, 640, 720,
                                     true, UINT32_MAX)) {
    fprintf(stderr, "self-test X11 nested-parent response: %s\n",
            response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
    self_test_failure("X11 nested-parent absolute coordinates");
    goto cleanup;
  }
  for (const char *role = "target"; role; role =
       strcmp(role, "target") == 0 ? "previous" :
       strcmp(role, "previous") == 0 ? "panel" : NULL) {
    json_object *surface = x11_self_test_response_surface(response, role);
    json_object *geometry = NULL;
    json_object *parent_is_root = NULL;
    if (!surface || !json_object_object_get_ex(surface, "geometry", &geometry) ||
        !json_object_object_get_ex(geometry, "parentIsRoot", &parent_is_root) ||
        json_object_get_boolean(parent_is_root)) {
      self_test_failure("X11 nested-parent final snapshot parent");
      goto cleanup;
    }
  }
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;
  release_lease(&state);

  const struct {
    const char *name;
    const char *surface_code;
  } inspection_faults[] = {
    {.name = "invalid-xid", .surface_code = "XCB_REQUEST_ERROR"},
    {.name = "wrong-class", .surface_code = "WINDOW_CLASS_MISMATCH"},
    {.name = "wrong-profile", .surface_code = "WINDOW_PROFILE_MISMATCH"},
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
    {.name = "uid-mismatch", .surface_code = "WINDOW_UID_MISMATCH"},
    {.name = "starttime-change", .surface_code = "WINDOW_PID_REUSED"},
#endif
  };
  static const char valid_wm_class[] = "chromium\0Chromium";
  static const char invalid_wm_class[] = "fixture\0Fixture";
  for (size_t index = 0;
       index < sizeof(inspection_faults) / sizeof(inspection_faults[0]); index++) {
    char request_id[64];
    uint64_t generation = index + 8;
    const void *wm_class = strcmp(inspection_faults[index].name, "wrong-class") == 0
      ? (const void *)invalid_wm_class : (const void *)valid_wm_class;
    size_t wm_class_length = strcmp(inspection_faults[index].name, "wrong-class") == 0
      ? sizeof(invalid_wm_class) : sizeof(valid_wm_class);
    xcb_change_property(fixture_connection, XCB_PROP_MODE_REPLACE, nested_target,
                        XCB_ATOM_WM_CLASS, XCB_ATOM_STRING, 8,
                        (uint32_t)wm_class_length, wm_class);
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
    self_test_identity_fault_pid = (uint32_t)getpid();
    self_test_identity_mode = SELF_TEST_IDENTITY_NORMAL;
    self_test_identity_read_count = 0;
    if (strcmp(inspection_faults[index].name, "uid-mismatch") == 0) {
      self_test_identity_mode = SELF_TEST_IDENTITY_UID_MISMATCH;
    } else if (strcmp(inspection_faults[index].name, "starttime-change") == 0) {
      self_test_identity_mode = SELF_TEST_IDENTITY_STARTTIME_CHANGE;
    }
#endif
    fixture_error = (AsyncError){0};
    xcb_get_input_focus_cookie_t inspection_fence = xcb_get_input_focus(fixture_connection);
    fixture_fence.sequence = inspection_fence.sequence;
    if (xcb_flush(fixture_connection) <= 0 ||
        collect_replies(&fixture_state, &fixture_fence, 1,
                        monotonic_ns() + 1000000000LL, &fixture_error) != 0 ||
        fixture_error.seen || fixture_fence.error || !fixture_fence.reply) {
      self_test_failure("X11 inspection fault fixture fence");
      goto cleanup;
    }
    free_pending(&fixture_fence, 1);
    memset(&fixture_fence, 0, sizeof(fixture_fence));
    if (!x11_self_test_publish_generation(generation_path, generation)) {
      self_test_failure("X11 inspection fault generation publish");
      goto cleanup;
    }
    snprintf(request_id, sizeof(request_id), "x11-%s", inspection_faults[index].name);
    request = x11_self_test_switch_request(&state, request_id, generation,
                                           nested_target, nested_previous, nested_panel, profile);
    json_object *target_request = x11_self_test_response_surface(request, "target");
    if (strcmp(inspection_faults[index].name, "invalid-xid") == 0) {
      json_object_object_add(target_request, "xid", json_object_new_int64(0x12345678));
    } else if (strcmp(inspection_faults[index].name, "wrong-profile") == 0) {
      json_object_object_add(target_request, "profile",
                             json_object_new_string("/tmp/tikpal-wrong-profile"));
    }
    response = switch_response(&state, request, request_id, monotonic_ns());
    json_object *target_result = x11_self_test_response_surface(response, "target");
    json_object *surface_code = NULL;
    json_object *mutation_started = NULL;
    if (!response || !json_object_object_get_ex(response, "ok", &value) ||
        json_object_get_boolean(value) ||
        !json_object_object_get_ex(response, "mutationStarted", &mutation_started) ||
        json_object_get_boolean(mutation_started) ||
        x11_self_test_mutation_count(response, NULL) != 0 ||
        !target_result || !json_object_object_get_ex(target_result, "code", &surface_code) ||
        strcmp(json_object_get_string(surface_code), inspection_faults[index].surface_code) != 0) {
      fprintf(stderr, "self-test X11 inspection fault response: %s\n",
              response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
      self_test_failure("X11 inspection fault zero-mutation rejection");
      goto cleanup;
    }
    json_object_put(response);
    response = NULL;
    json_object_put(request);
    request = NULL;
    release_lease(&state);
  }
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  self_test_identity_fault_pid = 0;
  self_test_identity_mode = SELF_TEST_IDENTITY_NORMAL;
  self_test_identity_read_count = 0;

  badwindow_target = create_x11_self_test_window(
    fixture_connection, fixture_screen, nested_parent,
    state.net_wm_pid, state.net_wm_opacity, 300, 20, 1200, 600, 0, true, UINT32_MAX);
  fixture_error = (AsyncError){0};
  xcb_get_input_focus_cookie_t badwindow_fence = xcb_get_input_focus(fixture_connection);
  fixture_fence.sequence = badwindow_fence.sequence;
  if (xcb_flush(fixture_connection) <= 0 ||
      collect_replies(&fixture_state, &fixture_fence, 1,
                      monotonic_ns() + 1000000000LL, &fixture_error) != 0 ||
      fixture_error.seen || fixture_fence.error || !fixture_fence.reply) {
    self_test_failure("X11 BadWindow fixture fence");
    goto cleanup;
  }
  free_pending(&fixture_fence, 1);
  memset(&fixture_fence, 0, sizeof(fixture_fence));
  uint64_t badwindow_generation =
    8 + sizeof(inspection_faults) / sizeof(inspection_faults[0]);
  if (!x11_self_test_publish_generation(generation_path, badwindow_generation)) {
    self_test_failure("X11 BadWindow generation publish");
    goto cleanup;
  }
  uint64_t epoch_before_badwindow = state.connection_epoch;
  request = x11_self_test_switch_request(&state, "x11-checked-badwindow",
                                         badwindow_generation, badwindow_target,
                                         nested_previous, nested_panel, profile);
  self_test_hook_connection = fixture_connection;
  self_test_hook_window = badwindow_target;
  self_test_hook_failed = false;
  self_test_before_mutation_hook = x11_self_test_destroy_before_mutation;
  response = switch_response(&state, request, "x11-checked-badwindow", monotonic_ns());
  self_test_before_mutation_hook = NULL;
  self_test_hook_connection = NULL;
  self_test_hook_window = XCB_WINDOW_NONE;
  badwindow_target = XCB_WINDOW_NONE;
  json_object *badwindow_code = NULL;
  json_object *badwindow_started = NULL;
  size_t attributed_badwindows = 0;
  json_object *badwindow_mutations = NULL;
  if (response && json_object_object_get_ex(response, "mutations", &badwindow_mutations)) {
    for (size_t index = 0; index < json_object_array_length(badwindow_mutations); index++) {
      json_object *mutation = json_object_array_get_idx(badwindow_mutations, index);
      json_object *error = NULL;
      json_object *error_code = NULL;
      json_object *resource_id = NULL;
      json_object *xid = NULL;
      json_object *checked = NULL;
      if (!json_object_object_get_ex(mutation, "checked", &checked) ||
          !json_object_get_boolean(checked)) continue;
      if (json_object_object_get_ex(mutation, "xcbError", &error) &&
          json_object_object_get_ex(error, "errorCode", &error_code) &&
          json_object_object_get_ex(error, "resourceId", &resource_id) &&
          json_object_object_get_ex(mutation, "xid", &xid) &&
          json_object_get_int(error_code) == XCB_WINDOW &&
          (xcb_window_t)json_object_get_int64(resource_id) ==
            (xcb_window_t)json_object_get_int64(xid)) {
        attributed_badwindows++;
      }
    }
  }
  if (self_test_hook_failed || !response ||
      !json_object_object_get_ex(response, "ok", &value) || json_object_get_boolean(value) ||
      !json_object_object_get_ex(response, "code", &badwindow_code) ||
      strcmp(json_object_get_string(badwindow_code), "XCB_MUTATION_ERROR") != 0 ||
      !json_object_object_get_ex(response, "mutationStarted", &badwindow_started) ||
      !json_object_get_boolean(badwindow_started) || attributed_badwindows == 0 ||
      state.connection_epoch != epoch_before_badwindow + 1) {
    fprintf(stderr, "self-test X11 BadWindow response: %s\n",
            response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
    self_test_failure("X11 checked BadWindow attribution");
    goto cleanup;
  }
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;
  if (connect_xcb(&state, true, monotonic_ns() + 1000000000LL) != 0) {
    self_test_failure("X11 reconnect after BadWindow");
    goto cleanup;
  }

  uint64_t badmatch_generation = badwindow_generation + 1;
  if (!x11_self_test_publish_generation(generation_path, badmatch_generation)) {
    self_test_failure("X11 BadMatch generation publish");
    goto cleanup;
  }
  uint64_t epoch_before_badmatch = state.connection_epoch;
  request = x11_self_test_switch_request(&state, "x11-checked-badmatch",
                                         badmatch_generation, nested_target,
                                         nested_previous, nested_panel, profile);
  self_test_bad_match_sibling = state.screen->root;
  response = switch_response(&state, request, "x11-checked-badmatch", monotonic_ns());
  self_test_bad_match_sibling = XCB_WINDOW_NONE;
  json_object *badmatch_code = NULL;
  json_object *badmatch_mutations = NULL;
  bool badmatch_attributed = false;
  if (response && json_object_object_get_ex(response, "mutations", &badmatch_mutations)) {
    for (size_t index = 0; index < json_object_array_length(badmatch_mutations); index++) {
      json_object *mutation = json_object_array_get_idx(badmatch_mutations, index);
      json_object *action = NULL;
      json_object *error = NULL;
      json_object *error_code = NULL;
      if (json_object_object_get_ex(mutation, "action", &action) &&
          strcmp(json_object_get_string(action), "self_test_bad_match") == 0 &&
          json_object_object_get_ex(mutation, "xcbError", &error) &&
          json_object_object_get_ex(error, "errorCode", &error_code) &&
          json_object_get_int(error_code) == XCB_MATCH) {
        badmatch_attributed = true;
      }
    }
  }
  if (!response || !json_object_object_get_ex(response, "ok", &value) ||
      json_object_get_boolean(value) ||
      !json_object_object_get_ex(response, "code", &badmatch_code) ||
      strcmp(json_object_get_string(badmatch_code), "XCB_MUTATION_ERROR") != 0 ||
      !badmatch_attributed || state.connection_epoch != epoch_before_badmatch + 1) {
    fprintf(stderr, "self-test X11 BadMatch response: %s\n",
            response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
    self_test_failure("X11 checked BadMatch attribution");
    goto cleanup;
  }
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;
  if (connect_xcb(&state, true, monotonic_ns() + 1000000000LL) != 0) {
    self_test_failure("X11 reconnect after BadMatch");
    goto cleanup;
  }

  uint64_t not_ready_generation = badmatch_generation + 1;
  if (!x11_self_test_publish_generation(generation_path, not_ready_generation)) {
    self_test_failure("X11 checked-not-ready generation publish");
    goto cleanup;
  }
  uint64_t epoch_before_not_ready = state.connection_epoch;
  request = x11_self_test_switch_request(&state, "x11-checked-not-ready",
                                         not_ready_generation, nested_target,
                                         nested_previous, nested_panel, profile);
  self_test_checked_not_ready = true;
  response = switch_response(&state, request, "x11-checked-not-ready", monotonic_ns());
  self_test_checked_not_ready = false;
  json_object *not_ready_code = NULL;
  json_object *not_ready_mutations = NULL;
  bool unchecked_cookie_seen = false;
  if (response && json_object_object_get_ex(response, "mutations", &not_ready_mutations)) {
    for (size_t index = 0; index < json_object_array_length(not_ready_mutations); index++) {
      json_object *mutation = json_object_array_get_idx(not_ready_mutations, index);
      json_object *checked = NULL;
      if (json_object_object_get_ex(mutation, "checked", &checked) &&
          !json_object_get_boolean(checked)) unchecked_cookie_seen = true;
    }
  }
  if (!response || !json_object_object_get_ex(response, "ok", &value) ||
      json_object_get_boolean(value) ||
      !json_object_object_get_ex(response, "code", &not_ready_code) ||
      strcmp(json_object_get_string(not_ready_code), "XCB_CHECK_NOT_READY_AFTER_FENCE") != 0 ||
      !unchecked_cookie_seen || state.connection_epoch != epoch_before_not_ready + 1) {
    fprintf(stderr, "self-test X11 checked-not-ready response: %s\n",
            response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
    self_test_failure("X11 checked cookie not ready after fence");
    goto cleanup;
  }
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;
  if (connect_xcb(&state, true, monotonic_ns() + 1000000000LL) != 0) {
    self_test_failure("X11 reconnect after checked-not-ready");
    goto cleanup;
  }

  uint64_t final_mismatch_generation = not_ready_generation + 1;
  if (!x11_self_test_publish_generation(generation_path, final_mismatch_generation)) {
    self_test_failure("X11 final-mismatch generation publish");
    goto cleanup;
  }
  uint64_t epoch_before_final_mismatch = state.connection_epoch;
  request = x11_self_test_switch_request(&state, "x11-final-mismatch",
                                         final_mismatch_generation, nested_target,
                                         nested_previous, nested_panel, profile);
  self_test_hook_connection = fixture_connection;
  self_test_hook_window = nested_target;
  self_test_hook_failed = false;
  self_test_before_final_query_hook = x11_self_test_move_before_final_query;
  response = switch_response(&state, request, "x11-final-mismatch", monotonic_ns());
  self_test_before_final_query_hook = NULL;
  self_test_hook_connection = NULL;
  self_test_hook_window = XCB_WINDOW_NONE;
  json_object *final_mismatch_code = NULL;
  if (self_test_hook_failed || !response ||
      !json_object_object_get_ex(response, "ok", &value) || json_object_get_boolean(value) ||
      !json_object_object_get_ex(response, "code", &final_mismatch_code) ||
      strcmp(json_object_get_string(final_mismatch_code), "FINAL_STATE_MISMATCH") != 0 ||
      x11_self_test_surface_matches(response, "target", 0, 0, 1920, 720,
                                    true, UINT32_MAX) ||
      state.connection_epoch != epoch_before_final_mismatch || !state.lease_active) {
    fprintf(stderr, "self-test X11 final-mismatch response: %s\n",
            response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
    self_test_failure("X11 final snapshot mismatch rejection");
    goto cleanup;
  }
  json_object_put(response);
  response = NULL;
  json_object_put(request);
  request = NULL;
  release_lease(&state);

  if (xserver_pid > 1) {
    uint64_t timeout_generation = final_mismatch_generation + 1;
    if (!x11_self_test_publish_generation(generation_path, timeout_generation)) {
      self_test_failure("X11 timeout generation publish");
      goto cleanup;
    }
    request = x11_self_test_switch_request(&state, "x11-server-timeout",
                                           timeout_generation, nested_target,
                                           nested_previous, nested_panel, profile);
    uint64_t epoch_before_timeout = state.connection_epoch;
    pid_t resume_child = fork();
    if (resume_child < 0) {
      self_test_failure("X11 timeout resume fork");
      goto cleanup;
    }
    if (resume_child == 0) {
      int delay_ms = SELF_TEST_TRANSACTION_TIMEOUT_MS + 200;
      struct timespec delay = {
        .tv_sec = delay_ms / 1000,
        .tv_nsec = (long)(delay_ms % 1000) * 1000000L
      };
      while (nanosleep(&delay, &delay) != 0 && errno == EINTR) {}
      _exit(kill(xserver_pid, SIGCONT) == 0 ? 0 : 1);
    }
    if (kill(xserver_pid, SIGSTOP) != 0) {
      int child_status;
      (void)waitpid(resume_child, &child_status, 0);
      self_test_failure("X11 timeout server stop");
      goto cleanup;
    }
    int64_t timeout_started_ns = monotonic_ns();
    response = switch_response(&state, request, "x11-server-timeout", timeout_started_ns);
    int64_t timeout_elapsed_ns = monotonic_ns() - timeout_started_ns;
    int child_status = 0;
    if (waitpid(resume_child, &child_status, 0) != resume_child ||
        !WIFEXITED(child_status) || WEXITSTATUS(child_status) != 0) {
      self_test_failure("X11 timeout server resume");
      goto cleanup;
    }
    json_object *timeout_code = NULL;
    json_object *timeout_started = NULL;
    json_object *timeout_released = NULL;
    json_object *timeout_collector = NULL;
    json_object *timeout_collector_result = NULL;
    json_object *timeout_final_scan = NULL;
    json_object *timeout_pending = NULL;
    if (!response || !json_object_object_get_ex(response, "ok", &value) ||
        json_object_get_boolean(value) ||
        !json_object_object_get_ex(response, "code", &timeout_code) ||
        strcmp(json_object_get_string(timeout_code), "X11_REPLY_TIMEOUT") != 0 ||
        !json_object_object_get_ex(response, "mutationStarted", &timeout_started) ||
        json_object_get_boolean(timeout_started) ||
        !json_object_object_get_ex(response, "leaseReleased", &timeout_released) ||
        !json_object_get_boolean(timeout_released) ||
        !json_object_object_get_ex(response, "collectorDiagnostics", &timeout_collector) ||
        !json_object_object_get_ex(timeout_collector, "result", &timeout_collector_result) ||
        strcmp(json_object_get_string(timeout_collector_result), "X11_REPLY_TIMEOUT") != 0 ||
        !json_object_object_get_ex(timeout_collector, "finalScan", &timeout_final_scan) ||
        !json_object_get_boolean(timeout_final_scan) ||
        !json_object_object_get_ex(timeout_collector, "pending", &timeout_pending) ||
        json_object_array_length(timeout_pending) != 21 ||
        timeout_elapsed_ns < (int64_t)(SELF_TEST_TRANSACTION_TIMEOUT_MS - 50) * 1000000LL ||
        timeout_elapsed_ns >= (int64_t)(SELF_TEST_TRANSACTION_TIMEOUT_MS + 150) * 1000000LL ||
        state.connection != NULL || state.connection_epoch != epoch_before_timeout + 1) {
      fprintf(stderr, "self-test X11 timeout response elapsed_ms=%.3f response=%s\n",
              (double)timeout_elapsed_ns / 1000000.0,
              response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
      self_test_failure("X11 absolute timeout and epoch invalidation");
      goto cleanup;
    }
    json_object_put(response);
    response = NULL;
    if (connect_xcb(&state, true, monotonic_ns() + 1000000000LL) != 0 ||
        state.connection_epoch != epoch_before_timeout + 2) {
      self_test_failure("X11 reconnect after server timeout");
      goto cleanup;
    }
    response = switch_response(&state, request, "x11-stale-epoch", monotonic_ns());
    json_object *stale_epoch_code = NULL;
    if (!response || !json_object_object_get_ex(response, "ok", &value) ||
        json_object_get_boolean(value) ||
        !json_object_object_get_ex(response, "code", &stale_epoch_code) ||
        strcmp(json_object_get_string(stale_epoch_code), "CONNECTION_EPOCH_MISMATCH") != 0 ||
        x11_self_test_mutation_count(response, NULL) != SIZE_MAX) {
      fprintf(stderr, "self-test X11 stale-epoch response: %s\n",
              response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
      self_test_failure("X11 stale epoch rejection");
      goto cleanup;
    }
    json_object_put(response);
    response = NULL;
    json_object_put(request);
    request = NULL;

    uint64_t clean_generation = timeout_generation + 1;
    if (!x11_self_test_publish_generation(generation_path, clean_generation)) {
      self_test_failure("X11 clean reconnect generation publish");
      goto cleanup;
    }
    request = x11_self_test_switch_request(&state, "x11-clean-reconnect",
                                           clean_generation, nested_target,
                                           nested_previous, nested_panel, profile);
    response = switch_response(&state, request, "x11-clean-reconnect", monotonic_ns());
    if (!response || !json_object_object_get_ex(response, "ok", &value) ||
        !json_object_get_boolean(value) || !x11_self_test_mutations_ok(response)) {
      fprintf(stderr, "self-test X11 clean-reconnect response: %s\n",
              response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
      self_test_failure("X11 old cookies isolated from new connection");
      goto cleanup;
    }
    json_object_put(response);
    response = NULL;
    json_object_put(request);
    request = NULL;
    release_lease(&state);

    uint64_t final_identity_generation = clean_generation + 1;
    if (!x11_self_test_publish_generation(generation_path, final_identity_generation)) {
      self_test_failure("X11 final-identity generation publish");
      goto cleanup;
    }
    uint64_t epoch_before_final_identity = state.connection_epoch;
    request = x11_self_test_switch_request(&state, "x11-final-identity",
                                           final_identity_generation, nested_target,
                                           nested_previous, nested_panel, profile);
    self_test_hook_connection = fixture_connection;
    self_test_hook_window = nested_target;
    self_test_hook_pid_atom = state.net_wm_pid;
    self_test_hook_failed = false;
    self_test_before_final_query_hook = x11_self_test_change_pid_before_final_query;
    response = switch_response(&state, request, "x11-final-identity", monotonic_ns());
    self_test_before_final_query_hook = NULL;
    self_test_hook_connection = NULL;
    self_test_hook_window = XCB_WINDOW_NONE;
    self_test_hook_pid_atom = XCB_ATOM_NONE;
    json_object *final_identity_code = NULL;
    json_object *final_identity_started = NULL;
    json_object *final_identity_target = x11_self_test_response_surface(response, "target");
    json_object *final_identity_target_code = NULL;
    if (self_test_hook_failed || !response ||
        !json_object_object_get_ex(response, "ok", &value) || json_object_get_boolean(value) ||
        !json_object_object_get_ex(response, "code", &final_identity_code) ||
        strcmp(json_object_get_string(final_identity_code), "WINDOW_IDENTITY_CHANGED") != 0 ||
        !json_object_object_get_ex(response, "mutationStarted", &final_identity_started) ||
        !json_object_get_boolean(final_identity_started) || !final_identity_target ||
        !json_object_object_get_ex(final_identity_target, "code", &final_identity_target_code) ||
        strcmp(json_object_get_string(final_identity_target_code), "WINDOW_IDENTITY_CHANGED") != 0 ||
        state.connection_epoch != epoch_before_final_identity || !state.lease_active) {
      fprintf(stderr, "self-test X11 final identity response: %s\n",
              response ? json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN) : "null");
      self_test_failure("X11 final identity rejection");
      goto cleanup;
    }
    json_object_put(response);
    response = NULL;
    json_object_put(request);
    request = NULL;
    release_lease(&state);
  }
#endif
  result = 0;

cleanup:
  free(tree);
  free_pending(&stack_pending, 1);
  free_pending(&fixture_fence, 1);
  if (response) json_object_put(response);
  if (request) json_object_put(request);
  if (surfaces) json_object_put(surfaces);
  if (fixture_connection) {
    if (badwindow_target != XCB_WINDOW_NONE) {
      xcb_destroy_window(fixture_connection, badwindow_target);
    }
    if (nested_parent != XCB_WINDOW_NONE) xcb_destroy_window(fixture_connection, nested_parent);
    if (target != XCB_WINDOW_NONE) xcb_destroy_window(fixture_connection, target);
    if (previous != XCB_WINDOW_NONE) xcb_destroy_window(fixture_connection, previous);
    if (panel != XCB_WINDOW_NONE) xcb_destroy_window(fixture_connection, panel);
    xcb_flush(fixture_connection);
    xcb_disconnect(fixture_connection);
  }
  if (state.connection) xcb_disconnect(state.connection);
  unlink(generation_path);
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  self_test_identity_pid = 0;
  self_test_identity_profile = NULL;
  self_test_identity_fault_pid = 0;
  self_test_identity_mode = SELF_TEST_IDENTITY_NORMAL;
  self_test_identity_read_count = 0;
  self_test_before_mutation_hook = NULL;
  self_test_before_final_query_hook = NULL;
  self_test_hook_pid_atom = XCB_ATOM_NONE;
  self_test_bad_match_sibling = XCB_WINDOW_NONE;
  self_test_checked_not_ready = false;
  self_test_hook_connection = NULL;
  self_test_hook_window = XCB_WINDOW_NONE;
  self_test_hook_failed = false;
#endif
  return result;
}

static int x11_sequence_self_test(const char *display) {
  HelperState state = {0};
  PendingReply pending = {0};
  AsyncError async_error = {0};
  int screen_number = 0;
  state.connection = xcb_connect(display, &screen_number);
  if (!state.connection || xcb_connection_has_error(state.connection) != 0) {
    if (state.connection) xcb_disconnect(state.connection);
    return self_test_failure("X11 sequence connection");
  }
  for (uint32_t index = 0; index < 70000; index++) {
    (void)xcb_no_operation(state.connection);
  }
  xcb_get_input_focus_cookie_t fence = xcb_get_input_focus(state.connection);
  pending.sequence = fence.sequence;
  if (xcb_flush(state.connection) <= 0 ||
      collect_replies(&state, &pending, 1, monotonic_ns() + 5000000000LL, &async_error) != 0 ||
      async_error.seen || pending.error || !pending.reply) {
    free_pending(&pending, 1);
    xcb_disconnect(state.connection);
    return self_test_failure("X11 32-bit sequence rollover fence");
  }
  free_pending(&pending, 1);
  xcb_disconnect(state.connection);
  return 0;
}

#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
static int x11_collector_self_test(const char *display) {
  HelperState state = {0};
  PendingReply pending = {0};
  AsyncError async_error = {0};
  struct pollfd descriptor = {0};
  int screen_number = 0;
  CollectResult result;
  state.connection = xcb_connect(display, &screen_number);
  if (!state.connection || xcb_connection_has_error(state.connection) != 0) {
    if (state.connection) xcb_disconnect(state.connection);
    return self_test_failure("X11 collector connection");
  }
  xcb_get_input_focus_cookie_t fence = xcb_get_input_focus(state.connection);
  pending.sequence = fence.sequence;
  if (xcb_flush(state.connection) <= 0) {
    xcb_disconnect(state.connection);
    return self_test_failure("X11 collector fence flush");
  }
  descriptor.fd = xcb_get_file_descriptor(state.connection);
  descriptor.events = POLLIN | POLLERR | POLLHUP;
  if (poll(&descriptor, 1, 1000) <= 0 || !(descriptor.revents & POLLIN)) {
    xcb_disconnect(state.connection);
    return self_test_failure("X11 collector reply readiness");
  }
  self_test_defer_reply_scan_once = true;
  self_test_force_poll_timeout_once = true;
  result = collect_replies(&state, &pending, 1, monotonic_ns() + 1000000000LL,
                           &async_error);
  if (result != COLLECT_OK || async_error.seen || pending.error || !pending.reply ||
      !state.last_collect.final_scan || !state.last_collect.final_scan_progressed ||
      state.last_collect.completed_count != 1) {
    free_pending(&pending, 1);
    xcb_disconnect(state.connection);
    return self_test_failure("X11 collector final reply scan");
  }
  free_pending(&pending, 1);
  pending = (PendingReply){.sequence = UINT32_MAX};
  stop_requested = 1;
  result = collect_replies(&state, &pending, 1, monotonic_ns() + 1000000000LL,
                           &async_error);
  stop_requested = 0;
  if (result != COLLECT_INTERRUPTED || !state.last_collect.stop_requested ||
      state.last_collect.result != COLLECT_INTERRUPTED) {
    xcb_disconnect(state.connection);
    return self_test_failure("X11 collector interrupted status");
  }
  xcb_disconnect(state.connection);
  return 0;
}
#endif

static int run_self_test(int argc, char **argv) {
  const char *display = NULL;
  const char *profile = NULL;
  pid_t xserver_pid = 0;
  bool x11_sequence = false;
  bool x11_transaction = false;
  bool x11_collector = false;
  bool x11_watch = false;
  for (int index = 2; index < argc; index++) {
    if (strcmp(argv[index], "--x11-sequence") == 0) x11_sequence = true;
    else if (strcmp(argv[index], "--x11-transaction") == 0) x11_transaction = true;
    else if (strcmp(argv[index], "--x11-collector") == 0) x11_collector = true;
    else if (strcmp(argv[index], "--x11-watch") == 0) x11_watch = true;
    else if (strcmp(argv[index], "--display") == 0 && index + 1 < argc) display = argv[++index];
    else if (strcmp(argv[index], "--xserver-pid") == 0 && index + 1 < argc) {
      char *end = NULL;
      long parsed = strtol(argv[++index], &end, 10);
      if (!end || *end || parsed <= 1 || parsed > INT_MAX) return 64;
      xserver_pid = (pid_t)parsed;
    }
    else if (strncmp(argv[index], "--user-data-dir=", 16) == 0 && argv[index][16]) {
      profile = argv[index] + 16;
    }
    else return 64;
  }
  if (command_line_self_test() != 0 || owner_file_self_test() != 0 ||
      framing_self_test() != 0 || protocol_self_test() != 0 || guard_pause_self_test() != 0 ||
      lease_arbitration_self_test() != 0) return 1;
  if (x11_sequence) {
    if (!display || !display[0]) display = getenv("DISPLAY");
    if (!display || !display[0] || x11_sequence_self_test(display) != 0) return 1;
  }
  if (x11_transaction) {
    if (!display || !display[0]) display = getenv("DISPLAY");
    if (!display || !display[0] || !profile || !profile[0] ||
        x11_transaction_self_test(display, profile, xserver_pid) != 0) return 1;
  }
  if (x11_watch) {
    if (!display || !display[0]) display = getenv("DISPLAY");
    if (!display || !display[0] || x11_watch_self_test(display) != 0) return 1;
  }
#ifdef TIKPAL_X11_HELPER_SELF_TEST_SEAMS
  if (x11_collector) {
    if (!display || !display[0]) display = getenv("DISPLAY");
    if (!display || !display[0] || x11_collector_self_test(display) != 0) return 1;
  }
#else
  if (x11_collector) return 64;
#endif
  printf("tikpal-x11-helper self-test passed%s%s%s%s\n",
         x11_sequence ? " with X11 sequence rollover" : "",
         x11_transaction ? " with X11 transaction" : "",
         x11_collector ? " with X11 collector" : "",
         x11_watch ? " with X11 watch" : "");
  return 0;
}

static void usage(FILE *output) {
  fprintf(output,
          "Usage:\n"
          "  tikpal-x11-helper daemon [--socket PATH] [--display DISPLAY] [--generation-file PATH] [--phase 0|1|3] [--transaction-timeout-ms N]\n"
          "  tikpal-x11-helper client health [--socket PATH] [--request-id ID]\n"
          "  tikpal-x11-helper client inspect --request-id ID [--generation N] --surface ROLE XID PROFILE [...]\n"
          "  tikpal-x11-helper client screen-probe --request-id ID\n"
          "  tikpal-x11-helper client switch --request-id ID --daemon-instance-id ID --connection-epoch N --generation N --lease-id ID --surface ROLE XID PROFILE X Y WIDTH HEIGHT OPACITY|keep [...]\n"
          "  tikpal-x11-helper client revoke --request-id ID --daemon-instance-id ID --connection-epoch N --generation N --lease-id ID\n"
          "  tikpal-x11-helper client owner-publish --file PATH --json OWNER_STATE_JSON\n"
          "  tikpal-x11-helper client owner-allows --file PATH --generation-file PATH (--xid XID [...]|--all)\n"
          "  tikpal-x11-helper client guard-process-verify --pid PID --starttime STARTTIME\n"
          "  tikpal-x11-helper client request [--socket PATH] < request.json\n"
          "  tikpal-x11-helper monotonic-ns\n"
          "  tikpal-x11-helper self-test [--x11-sequence] [--x11-transaction --user-data-dir=PROFILE] [--x11-watch] [--display DISPLAY] [--xserver-pid PID]\n");
}

int main(int argc, char **argv) {
  if (argc < 2) {
    usage(stderr);
    return 64;
  }
  if (strcmp(argv[1], "monotonic-ns") == 0) {
    if (argc != 2) {
      usage(stderr);
      return 64;
    }
    printf("%" PRId64 "\n", monotonic_ns());
    return 0;
  }
  if (strcmp(argv[1], "self-test") == 0) {
    int result = run_self_test(argc, argv);
    if (result == 64) usage(stderr);
    return result;
  }
  if (strcmp(argv[1], "client") == 0) {
    if (argc < 3) {
      usage(stderr);
      return 64;
    }
    int result = run_client(argc - 1, argv + 1);
    if (result == 64) usage(stderr);
    return result;
  }
  if (strcmp(argv[1], "daemon") != 0 && strcmp(argv[1], "serve") != 0) {
    int result = run_client(argc, argv);
    if (result == 64) usage(stderr);
    return result;
  }

  HelperState state = {0};
  const char *socket_path = DEFAULT_SOCKET_PATH;
  const char *display = getenv("DISPLAY");
  const char *generation_path = DEFAULT_GENERATION_PATH;
  const char *phase_environment = getenv("TIKPAL_X11_HELPER_PHASE");
  state.phase = 0;
  state.transaction_timeout_ms = DEFAULT_TRANSACTION_TIMEOUT_MS;
  if (phase_environment && phase_environment[0] &&
      !parse_phase(phase_environment, &state.phase)) {
    usage(stderr);
    return 64;
  }
  for (int index = 2; index < argc; index++) {
    if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) socket_path = argv[++index];
    else if (strcmp(argv[index], "--display") == 0 && index + 1 < argc) display = argv[++index];
    else if (strcmp(argv[index], "--generation-file") == 0 && index + 1 < argc) generation_path = argv[++index];
    else if (strcmp(argv[index], "--phase") == 0 && index + 1 < argc &&
             parse_phase(argv[++index], &state.phase)) {
    }
    else if (strcmp(argv[index], "--transaction-timeout-ms") == 0 && index + 1 < argc) state.transaction_timeout_ms = atoi(argv[++index]);
    else {
      usage(stderr);
      return 64;
    }
  }
  if (!display || !display[0] || strlen(display) >= sizeof(state.display) ||
      strlen(generation_path) >= sizeof(state.generation_path) ||
      state.transaction_timeout_ms <= 0 || state.transaction_timeout_ms >= 10000) {
    usage(stderr);
    return 64;
  }
  snprintf(state.display, sizeof(state.display), "%s", display);
  snprintf(state.generation_path, sizeof(state.generation_path), "%s", generation_path);
  load_instance_id(state.daemon_instance_id);
  load_generation_floor(&state);
  if (connect_xcb(&state, false, monotonic_ns() + 1000000000LL) != 0) {
    fprintf(stderr, "could not connect to X display %s\n", state.display);
    return 69;
  }
  signal(SIGTERM, handle_signal);
  signal(SIGINT, handle_signal);
  signal(SIGPIPE, SIG_IGN);
  umask(0077);
  int result = serve(&state, socket_path);
  if (state.connection) xcb_disconnect(state.connection);
  return result;
}

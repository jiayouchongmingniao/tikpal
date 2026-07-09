const REMOTE_ACTION_TYPES = [
  "playback.play_pause",
  "playback.play",
  "playback.pause",
  "playback.next",
  "playback.previous",
  "playback.seek",
  "playback.play_mode_set",
  "volume_set",
  "source.set",
  "room.set_mode",
  "room.start_session",
  "room.stop_session",
  "room.update_timer",
  "scene.set",
  "scene.sound_set",
  "hifi.eq_set",
  "display.brightness_set",
  "lyrics.refresh"
];

const ROOM_MODES = ["focus", "calm", "sleep", "hifi"];
const PLAYBACK_MODES = ["sequence", "repeat_one", "shuffle"];
const SOURCE_TARGETS = ["mpd", "radio", "spotify", "bluetooth", "airplay", "upnp"];
const HIFI_EQ_PRESETS = ["flat", "warm", "vocal"];
const WEB_MODE_PROVIDERS = ["spotify", "youtube_music", "apple_music", "tidal", "qobuz", "deezer", "amazon_music", "qq_music", "netease_music"];
const WEB_MODE_ACTION_TYPES = ["open", "close", "keyboard"];

function ref(name) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonResponse(description, schemaName) {
  return {
    description,
    content: {
      "application/json": {
        schema: ref(schemaName)
      }
    }
  };
}

export function buildOpenApiDocument({ appVersion = "0.1.0" } = {}) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Tikpal Portable Remote API",
      version: appVersion,
      description: "Safe facade for portable controllers. Internal kiosk and playlist-management APIs remain local-only."
    },
    servers: [
      { url: "/api/v1", description: "Tikpal local API" }
    ],
    paths: {
      "/remote/state": {
        get: {
          tags: ["remote"],
          summary: "Read portable remote state",
          responses: {
            200: jsonResponse("Portable remote state", "RemoteStateResponse")
          }
        }
      },
      "/remote/catalog": {
        get: {
          tags: ["remote"],
          summary: "Read portable remote control catalog",
          responses: {
            200: jsonResponse("Portable remote catalog", "RemoteCatalogResponse")
          }
        }
      },
      "/remote/actions": {
        post: {
          tags: ["remote"],
          summary: "Apply one portable remote action",
          security: [{ TikpalKey: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: ref("RemoteActionRequest")
              }
            }
          },
          responses: {
            200: jsonResponse("Updated portable remote state", "RemoteStateResponse"),
            400: jsonResponse("Bad request", "ErrorResponse"),
            403: jsonResponse("Forbidden", "ErrorResponse")
          }
        }
      },
      "/web-mode/state": {
        get: {
          tags: ["web-mode"],
          summary: "Read Explore provider and proxy state",
          responses: {
            200: jsonResponse("Explore state", "WebModeState")
          }
        }
      },
      "/web-mode/actions": {
        post: {
          tags: ["web-mode"],
          summary: "Open, close, or surface Explore keyboard",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: ref("WebModeActionRequest")
              }
            }
          },
          responses: {
            200: jsonResponse("Explore state", "WebModeState"),
            400: jsonResponse("Bad request", "ErrorResponse")
          }
        }
      },
      "/web-mode/settings": {
        patch: {
          tags: ["web-mode"],
          summary: "Update Explore proxy settings",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: ref("WebModeSettingsPatch")
              }
            }
          },
          responses: {
            200: jsonResponse("Explore state", "WebModeState"),
            400: jsonResponse("Bad request", "ErrorResponse")
          }
        }
      },
      "/web-mode/proxy-test": {
        post: {
          tags: ["web-mode"],
          summary: "Validate Explore proxy configuration",
          responses: {
            200: jsonResponse("Proxy test result", "WebModeProxyTestResponse"),
            400: jsonResponse("Bad request", "ErrorResponse")
          }
        }
      },
      "/openapi.json": {
        get: {
          tags: ["docs"],
          summary: "OpenAPI document",
          responses: {
            200: jsonResponse("OpenAPI document", "OpenApiDocument")
          }
        }
      },
      "/swagger.json": {
        get: {
          tags: ["docs"],
          summary: "Swagger-compatible OpenAPI document",
          responses: {
            200: jsonResponse("OpenAPI document", "OpenApiDocument")
          }
        }
      },
      "/docs": {
        get: {
          tags: ["docs"],
          summary: "Lightweight local API documentation page",
          responses: {
            200: {
              description: "HTML documentation page",
              content: {
                "text/html": {
                  schema: { type: "string" }
                }
              }
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        TikpalKey: {
          type: "apiKey",
          in: "header",
          name: "X-Tikpal-Key"
        }
      },
      schemas: {
        OpenApiDocument: {
          type: "object",
          additionalProperties: true
        },
        ErrorResponse: {
          type: "object",
          required: ["error", "message"],
          properties: {
            error: { type: "string" },
            message: { type: "string" }
          }
        },
        WebModeProvider: {
          type: "object",
          required: ["id", "label", "url", "experimental"],
          properties: {
            id: { type: "string", enum: WEB_MODE_PROVIDERS },
            label: { type: "string" },
            url: { type: "string", format: "uri" },
            experimental: { type: "boolean" }
          }
        },
        WebModeSettings: {
          type: "object",
          required: ["proxyEnabled", "proxyUrl", "updatedAt"],
          properties: {
            proxyEnabled: { type: "boolean" },
            proxyUrl: { type: "string" },
            updatedAt: { type: "string", nullable: true }
          }
        },
        WebModeState: {
          type: "object",
          required: ["enabled", "activeProvider", "providers", "settings", "lastError", "updatedAt"],
          properties: {
            enabled: { type: "boolean" },
            activeProvider: { type: "string", enum: WEB_MODE_PROVIDERS, nullable: true },
            providers: {
              type: "array",
              items: ref("WebModeProvider")
            },
            settings: ref("WebModeSettings"),
            lastError: { type: "string", nullable: true },
            updatedAt: { type: "string", format: "date-time", nullable: true }
          }
        },
        WebModeActionRequest: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: WEB_MODE_ACTION_TYPES },
            provider: { type: "string", enum: WEB_MODE_PROVIDERS }
          },
          additionalProperties: false
        },
        WebModeSettingsPatch: {
          type: "object",
          properties: {
            proxyEnabled: { type: "boolean" },
            proxyUrl: { type: "string" }
          },
          additionalProperties: false
        },
        WebModeProxyTestResponse: {
          type: "object",
          required: ["ok", "message", "proxyUrl"],
          properties: {
            ok: { type: "boolean" },
            message: { type: "string" },
            proxyUrl: { type: "string" }
          }
        },
        RemoteStateResponse: {
          type: "object",
          required: ["playback", "volume", "room", "scene", "source", "display", "hifi", "runtime", "updatedAt"],
          properties: {
            playback: { type: "object", additionalProperties: true },
            volume: { type: "object", additionalProperties: true },
            room: { type: "object", additionalProperties: true },
            scene: { type: "object", additionalProperties: true },
            source: { type: "object", additionalProperties: true },
            display: { type: "object", additionalProperties: true },
            hifi: { type: "object", additionalProperties: true },
            runtime: { type: "object", additionalProperties: true },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        RemoteCatalogResponse: {
          type: "object",
          required: [
            "allowedActions",
            "playbackModes",
            "sourceTargets",
            "sources",
            "roomModes",
            "sceneVideos",
            "hifiEqPresets",
            "updatedAt"
          ],
          properties: {
            allowedActions: {
              type: "array",
              items: { type: "string", enum: REMOTE_ACTION_TYPES }
            },
            playbackModes: {
              type: "array",
              items: { type: "string", enum: PLAYBACK_MODES }
            },
            sourceTargets: {
              type: "array",
              items: { type: "string", enum: SOURCE_TARGETS }
            },
            sources: {
              type: "array",
              items: { type: "object", additionalProperties: true }
            },
            roomModes: {
              type: "array",
              items: { type: "object", additionalProperties: true }
            },
            sceneVideos: {
              type: "array",
              items: { type: "object", additionalProperties: true }
            },
            hifiEqPresets: {
              type: "array",
              items: { type: "object", additionalProperties: true }
            },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        RemoteActionRequest: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: REMOTE_ACTION_TYPES },
            value: { type: "number" },
            mode: { type: "string", enum: ROOM_MODES },
            playbackMode: { type: "string", enum: PLAYBACK_MODES },
            target: { type: "string", enum: SOURCE_TARGETS },
            radioStationId: { type: "string" },
            localTrackPath: { type: "string" },
            sceneVideoId: { type: "string" },
            sceneVideoLabel: { type: "string" },
            sceneVideoSrc: { type: "string" },
            sceneSoundEnabled: { type: "boolean" },
            enabled: { type: "boolean" },
            hifiEqPresetId: { type: "string", enum: HIFI_EQ_PRESETS },
            timerMinutes: { type: "integer", nullable: true },
            timerEndsAt: { type: "string", format: "date-time", nullable: true }
          },
          additionalProperties: false
        }
      }
    }
  };
}

export function buildOpenApiDocsHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tikpal Portable Remote API</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; color: #151515; background: #f8f8f6; line-height: 1.5; }
    main { max-width: 880px; margin: 0 auto; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin-top: 28px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { background: #111; color: #f7f7f2; padding: 16px; overflow-x: auto; border-radius: 6px; }
    a { color: #245e8f; }
  </style>
</head>
<body>
  <main>
    <h1>Tikpal Portable Remote API</h1>
    <p>This is the safe local facade for portable controllers. Internal kiosk and playlist-management endpoints remain local-only.</p>
    <h2>OpenAPI</h2>
    <p><a href="/api/v1/openapi.json">/api/v1/openapi.json</a> and <a href="/api/v1/swagger.json">/api/v1/swagger.json</a> expose the same Swagger-compatible document.</p>
    <h2>Endpoints</h2>
    <pre>GET  /api/v1/remote/state
GET  /api/v1/remote/catalog
POST /api/v1/remote/actions

Header for POST:
X-Tikpal-Key: &lt;TIKPAL_PORTABLE_API_KEY&gt;</pre>
  </main>
</body>
</html>`;
}

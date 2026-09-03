#!/usr/bin/env python3
"""Small JSONL client for tikpal-web-mode-cdp-manager.mjs.

It deliberately has no HTTP or WebSocket fallback: enabling the Manager makes
all callers observe its persistent-session failure semantics.
"""
import argparse
import json
import socket
import sys


def request(socket_path, payload, timeout):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(timeout)
        client.connect(socket_path)
        client.sendall((json.dumps(payload, separators=(",", ":")) + "\n").encode())
        received = b""
        while b"\n" not in received:
            chunk = client.recv(65536)
            if not chunk:
                raise RuntimeError("manager closed IPC socket")
            received += chunk
    return json.loads(received.split(b"\n", 1)[0].decode())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", default="/run/tikpal/cdp-session-manager.sock")
    parser.add_argument("--timeout", type=float, default=2.5)
    parser.add_argument("--provider")
    parser.add_argument("--op", default="command", choices=("command", "targets", "status", "browser-info", "watch-early-error", "close-target", "lifecycle"))
    parser.add_argument("--method")
    parser.add_argument("--params", default="{}")
    parser.add_argument("--retryable", action="store_true")
    parser.add_argument("--priority", choices=("foreground", "maintenance"), default="maintenance")
    parser.add_argument("--expected-value")
    parser.add_argument("--target-id")
    parser.add_argument("--error-page-url")
    parser.add_argument("--state", choices=("active", "frozen"))
    parser.add_argument("--raw-targets", action="store_true")
    args = parser.parse_args()
    payload = {"op": args.op, "provider": args.provider, "priority": args.priority}
    if args.op == "command":
        if not args.method:
            parser.error("--method is required for command")
        try:
            payload["params"] = json.loads(args.params)
        except json.JSONDecodeError as error:
            parser.error(f"invalid --params JSON: {error}")
        payload.update({"method": args.method, "retryable": args.retryable})
    if args.target_id:
        payload["targetId"] = args.target_id
    if args.error_page_url:
        payload["errorPageUrl"] = args.error_page_url
    if args.op == "lifecycle":
        if not args.state:
            parser.error("--state is required for lifecycle")
        payload["state"] = args.state
    try:
        response = request(args.socket, payload, args.timeout)
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error), "errorCode": "CDP_IPC_UNAVAILABLE"}))
        return 1
    if args.raw_targets:
        print(json.dumps(response.get("targets", []), separators=(",", ":")))
    else:
        print(json.dumps(response, separators=(",", ":")))
    if not response.get("ok"):
        return 1
    if args.expected_value is not None:
        try:
            expected = json.loads(args.expected_value)
        except json.JSONDecodeError as error:
            parser.error(f"invalid --expected-value JSON: {error}")
        value = response.get("result", {}).get("result", {}).get("value")
        return 0 if value == expected else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

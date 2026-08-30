#!/usr/bin/env python3
import fcntl
import os
import subprocess
import sys
import time


arguments = sys.argv[1:]
unlock = False
timeout = None
failure_status = 1
index = 0
while index < len(arguments) and arguments[index].startswith("-"):
    option = arguments[index]
    if option == "-u":
        unlock = True
        index += 1
    elif option in ("-x", "-o"):
        index += 1
    elif option in ("-w", "-E") and index + 1 < len(arguments):
        if option == "-w":
            timeout = float(arguments[index + 1])
        else:
            failure_status = int(arguments[index + 1])
        index += 2
    else:
        sys.exit(64)
if index >= len(arguments):
    sys.exit(64)
target = arguments[index]
command = arguments[index + 1 :]
owns_descriptor = not target.isdigit()
descriptor = os.open(target, os.O_CREAT | os.O_RDWR, 0o600) if owns_descriptor else int(target)
if unlock:
    fcntl.flock(descriptor, fcntl.LOCK_UN)
    if owns_descriptor:
        os.close(descriptor)
    sys.exit(0)
deadline = None if timeout is None else time.monotonic() + timeout
while True:
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if deadline is not None and time.monotonic() >= deadline:
            if owns_descriptor:
                os.close(descriptor)
            sys.exit(failure_status)
        time.sleep(0.01)
status = subprocess.run(command).returncode if command else 0
if owns_descriptor:
    os.close(descriptor)
sys.exit(status)

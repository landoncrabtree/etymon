"""Drive the actual neo-blessed application through a real POSIX terminal."""
import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import time

node, executable, project, home, cache = sys.argv[1:6]
mode = sys.argv[6] if len(sys.argv) > 6 else "rule"
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 38, 140, 0, 0))
environment = dict(os.environ, TERM="xterm-256color")
if mode == "add-local-mcp":
    command = ["mcp", "add", "local-server.json"]
elif mode.startswith("create-"):
    kind = mode.split("-")[1]
    command = [kind, "add" if kind == "skill" else "create"]
elif mode == "rule" or mode.startswith(("host-", "lossy-sync", "lossy-remove")):
    command = ["tui"]
else:
    command = ["uninstall"]
process = subprocess.Popen(
    [node, executable, *command, "--cwd", project, "--home", home,
     "--cache", cache, "--harness", "codex", *(["--global"] if mode.endswith("global") else [])],
    cwd=project, env=environment, stdin=slave, stdout=slave, stderr=slave,
)
os.close(slave)
output = bytearray()
cursor = 0


def expect(text):
    global cursor
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        position = output.find(text.encode(), cursor)
        if position >= 0:
            cursor = position + len(text.encode())
            return
        if select.select([master], [], [], 0.1)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError:
                break
        if process.poll() is not None:
            if text.encode() not in output[cursor:]:
                break
    raise AssertionError(f"TUI did not show {text!r}: {output[-5000:]!r}")


def send(text):
    os.write(master, text.encode())
    # Drain redraws while the next widget starts its native input listener.
    # Otherwise a full PTY output buffer can stall processing subsequent input.
    deadline = time.monotonic() + 0.15
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.02)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError:
                break


def wait_exit(expected_code=0):
    # Keep draining the PTY while redraws and terminal restoration are written.
    # Waiting on the process alone can fill the terminal output buffer.
    deadline = time.monotonic() + 10
    while process.poll() is None and time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError:
                break
    assert process.wait(timeout=1) == expected_code


try:
    if mode == "host-import-conflict":
        expect("Import native setup")
        send("jjjjjj\r")
        expect("All detected tools")
        send("\r")
        expect("import conflict")
        send("j\r")
        expect("source glob")
        send("product/templates/**\r")
        expect("import conflict")
        send("jj\r")
        expect("Import these resources")
        send("\r")
        expect("resources imported")
        send("q")
        wait_exit()
        print(json.dumps({"mode": mode, "exitCode": process.returncode}))
    elif mode == "host-import":
        expect("Import native setup")
        send("jjjjjj\r")
        expect("All detected tools")
        send("\r")
        expect("Import these resources")
        send("\r")
        expect("resources imported")
        send("q")
        wait_exit()
        print(json.dumps({"mode": mode, "exitCode": process.returncode}))
    elif mode == "lossy-remove":
        expect("Remove resource")
        send("jjjjjjjj\r")
        expect("conditional (authored)")
        send("\r")
        expect("Preview lossy conversion")
        send("\r")
        expect("always-on")
        expect("Cancel")
        send("\r")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with open(os.path.join(project, ".agents/etymon.toml")) as manifest:
                if "[rule.conditional]" not in manifest.read():
                    break
            if select.select([master], [], [], 0.1)[0]:
                output.extend(os.read(master, 65536))
        else:
            raise AssertionError("Lossy rule removal did not apply")
        send("q")
        wait_exit()
        print(json.dumps({"mode": mode, "exitCode": process.returncode}))
    elif mode.startswith("lossy-sync"):
        expect("Sync / preview")
        send("jjjjj\r")
        expect("Preview lossy conversion")
        send("\r")
        if mode.endswith("adopt"):
            expect("Preview taking ownership")
            send("\r")
        expect("RULE_CONDITIONS_DROPPED")
        expect("Apply native changes")
        send("\r")
        expect("changes applied")
        send("q")
        wait_exit()
        print(json.dumps({"mode": mode, "exitCode": process.returncode}))
    elif mode.startswith("create-") or mode.startswith("host-create"):
        hosted = mode.startswith("host-create")
        kind = mode.split("-")[1] if not hosted else "command" if mode.endswith("command") else "rule" if mode.endswith("rule") else "skill"
        if hosted:
            expect("Rules & Instructions" if kind == "rule" else "Add " + kind)
            send(("j" * 11 if kind == "command" else "jjjj" if kind == "rule" else "j") + "\r")
            expect("Add " + kind + ":")
            send("\r")
        expect("Instructions" if hosted else f"Create {kind}")
        if mode.endswith("cancel"):
            send("cancelled-resource\x03")
            wait_exit(130)
        else:
            # Invalid save must leave the form and values available for correction.
            if kind == "skill" and not hosted:
                send("\x13")
                expect("name:")
            name = "host-" + ("rule" if kind == "rule" else "checks") if hosted else "form-checks" if kind == "skill" else "form-reviewer" if kind == "agent" else "form-" + mode.split("-")[-1]
            send(name + "\t")
            if kind == "mcp":
                transport = mode.split("-")[-1]
                if transport != "stdio":
                    send("\x1b[B" * (1 if transport == "http" else 2))
                    expect("URL (HTTP / SSE)")
                send("\t")
                if transport == "stdio":
                    send("node\t")
                    send('\x7f\x7f["server.js", "two words"]\t')
                    send(".\t")
                    send("TOKEN=env:MCP_TOKEN,DEBUG=true")
                else:
                    send("https://example.com/" + transport + "\t")
                    send("Authorization=env:MCP_AUTH")
            else:
                send("Use when reviewing changes.\t")
                send("Review menu-created guidance." if hosted and kind == "rule" else "Review modular guidance.\r\r    Preserve indentation." if mode.endswith("modular") else "Review carefully.\r\r    Preserve indentation.")
                if kind == "rule" and not mode.endswith("global"):
                    send("\t")
                    send("\x7fpackages/tui\t")
                    if mode.endswith("glob"):
                        send("\x1b[B\t")
                        send("\x13")
                        expect("empty glob")
                        send("**/*.ts")
                    elif mode.endswith("modular"):
                        send("\t\x1b[B")
            send("\x13")
            expect("Created")
            if hosted:
                send("q")
            wait_exit()
        print(json.dumps({"mode": mode, "exitCode": process.returncode}))
    elif mode in ("add-local-mcp", "host-add-mcp"):
        if mode == "host-add-mcp":
            expect("Add MCP")
            send("jj\r")
            expect("Find MCP:")
            send("local-server.json\r")
        expect("mcp:local/local-server")
        if mode == "host-add-mcp":
            send("q")
        wait_exit()
        print(json.dumps({"mode": mode, "exitCode": process.returncode}))
    elif mode == "rule":
        expect("Rules & Instructions")
        send("jjjj\r")
        expect("Add rule:")
        send("./style.md\r")
        expect("rule names")
        send("\r")
        expect("Optional project directory scope")
        send("src\r")
        expect("rule:local/style")
        send("h")
        # neo-blessed updates spaces with cursor movements; use a contiguous ID.
        expect("(copilot-cloud)")
        send("\x1b")
        time.sleep(0.2)
        send("q")
        wait_exit()
        print(json.dumps({"startup": True, "ruleRegistered": True, "harnessDialog": True, "exitCode": 0}))
    else:
        expect("Keep personal files and uninstall")
        if mode == "uninstall-cancel":
            send("q")
            wait_exit(130)
        else:
            send("j\r" if mode == "uninstall-remove" else "\r")
            wait_exit()
        print(json.dumps({"mode": mode, "exitCode": process.returncode}))
finally:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    os.close(master)
    with open(os.path.join(project, f"tui-{mode}-terminal.log"), "wb") as log:
        log.write(output)

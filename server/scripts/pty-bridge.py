#!/usr/bin/env python3
"""Run a command inside a pseudo-terminal and relay it over plain pipes.

`claude setup-token` is a full-screen terminal app: through ordinary pipes it
prints nothing at all, and macOS `script` refuses when its own input is not a
terminal. This gives the child a real pty (sized wide, so a long sign-in URL is
not wrapped across lines) and copies bytes both ways: our stdin -> the pty,
the pty -> our stdout. It exits with the child.
"""
import fcntl, os, pty, select, signal, struct, sys, termios

cmd = sys.argv[1:]
if not cmd:
    sys.exit(2)

pid, fd = pty.fork()
if pid == 0:
    os.environ.setdefault('TERM', 'xterm-256color')
    os.execvp(cmd[0], cmd)

# 50 rows x 1000 columns: wide enough that no URL or token wraps.
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 1000, 0, 0))

def stop(*_):
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)

stdin_open = True
stdin = sys.stdin.fileno()
out = sys.stdout.buffer

def drain():
    try:
        while True:
            data = os.read(fd, 65536)
            if not data:
                return
            out.write(data); out.flush()
    except OSError:
        return

while True:
    watch = [fd] + ([stdin] if stdin_open else [])
    try:
        r, _, _ = select.select(watch, [], [], 1.0)
    except InterruptedError:
        continue
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break                      # the child closed the terminal
        if not data:
            break
        out.write(data); out.flush()
    if stdin_open and stdin in r:
        data = os.read(stdin, 65536)
        if data:
            os.write(fd, data)
        else:
            stdin_open = False         # our input closed; keep relaying output
    done, _ = os.waitpid(pid, os.WNOHANG)
    if done:
        drain()
        break

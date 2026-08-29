#!/bin/bash

APP_NAME="Mini-Bucket-Service"
APP_DIR="/home/ubuntu/production/minibucket"

PID_FILE="/${APP_DIR}/${APP_NAME}.pid"
LOG_FILE="/${APP_DIR}/data/logs/minibucket.log"

# Find pnpm
PNPM_BIN="$(which npm)"

if [ -z "$PNPM_BIN" ]; then
    echo "Error: pnpm is not installed or not in PATH."
    exit 1
fi

start() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")

        if kill -0 "$PID" 2>/dev/null; then
            echo "$APP_NAME is already running (PID: $PID)"
            exit 0
        fi

        rm -f "$PID_FILE"
    fi

    echo "Starting $APP_NAME..."

    cd "$APP_DIR" || {
        echo "Error: Cannot access $APP_DIR"
        exit 1
    }

    nohup "$PNPM_BIN" start >> "$LOG_FILE" 2>&1 &

    PID=$!
    echo "$PID" > "$PID_FILE"

    sleep 2

    if kill -0 "$PID" 2>/dev/null; then
        echo "$APP_NAME started successfully."
        echo "PID: $PID"
        echo "Log: $LOG_FILE"
    else
        echo "Failed to start $APP_NAME."
        rm -f "$PID_FILE"
        exit 1
    fi
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "$APP_NAME is not running."
        exit 0
    fi

    PID=$(cat "$PID_FILE")

    if ! kill -0 "$PID" 2>/dev/null; then
        echo "$APP_NAME is not running."
        rm -f "$PID_FILE"
        exit 0
    fi

    echo "Stopping $APP_NAME (PID: $PID)..."

    kill "$PID"

    for i in {1..10}; do
        if ! kill -0 "$PID" 2>/dev/null; then
            break
        fi

        sleep 1
    done

    if kill -0 "$PID" 2>/dev/null; then
        echo "Process did not stop gracefully. Killing..."
        kill -9 "$PID"
    fi

    rm -f "$PID_FILE"

    echo "$APP_NAME stopped."
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if [ ! -f "$PID_FILE" ]; then
        echo "$APP_NAME is stopped."
        exit 0
    fi

    PID=$(cat "$PID_FILE")

    if kill -0 "$PID" 2>/dev/null; then
        echo "$APP_NAME is running."
        echo "PID: $PID"
    else
        echo "$APP_NAME is stopped."
        rm -f "$PID_FILE"
    fi
}

logs() {
    if [ ! -f "$LOG_FILE" ]; then
        echo "No log file found."
        exit 1
    fi

    tail -f "$LOG_FILE"
}

case "$1" in
    start)
        start
        ;;

    stop)
        stop
        ;;

    restart)
        restart
        ;;

    status)
        status
        ;;

    logs)
        logs
        ;;

    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac

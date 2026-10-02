#!/bin/bash
cd "$(dirname "$0")"
npx vitest run "$@" > .vitest-last.log 2>&1
echo "EXIT:$?" >> .vitest-last.log

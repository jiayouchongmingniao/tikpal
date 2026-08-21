#!/bin/sh

# moodeutl exists only on moOde. Source helpers may call this on Gentoo too,
# where it intentionally becomes a successful no-op.
tikpal_moodeutl() {
  if command -v moodeutl >/dev/null 2>&1; then
    moodeutl "$@"
  fi
}

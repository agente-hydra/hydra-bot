#!/bin/bash
export HOME=/home/hydra-sec
export USER=hydra-sec
exec sudo -u hydra-sec /home/hydra-sec/.local/bin/agy "$@"
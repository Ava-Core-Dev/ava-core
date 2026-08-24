# AVA Desk SSH Mode

## Purpose

AVA Desk contains an SSH Mode interface for controlling the local OpenSSH
server on the AVA Core machine.

## Server

OpenSSH server:

    openssh-server

Service:

    ssh.service

Socket:

    ssh.socket

Default port:

    22

## Configuration

SSH was installed with:

    sudo apt install openssh-server

Enabled with:

    sudo systemctl enable --now ssh

## AVA Desk

The Desk provides:

- SSH status
- Port 22 status
- Enable SSH
- Disable SSH
- Refresh
- SSH key path information

## Important

The SSH toggle does NOT give an external AI or ChatGPT session SSH access.

It controls the SSH server on the local AVA Core machine.

An external client must separately support SSH and have network reachability
and authentication configured.

## Existing AVA Desk Key

    /home/ava-core/.ssh/ava_desk
    /home/ava-core/.ssh/ava_desk.pub

## Security

Do not store SSH private keys, passwords, tokens, or credentials in this
directory.

## Incident

2026-08-23 — SSH Mode added to AVA Core Visual CLI.

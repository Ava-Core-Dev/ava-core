#!/usr/bin/env python3
"""
Interactive chat with Meta AI (meta.ai).
Automatically installs meta-ai-api if missing.
"""

import subprocess
import sys
import importlib.util

PACKAGE = "meta-ai-api"
IMPORT_NAME = "meta_ai_api"


def is_installed(package_name: str) -> bool:
    """Return True if the package can be imported."""
    return importlib.util.find_spec(package_name) is not None


def install_package(package: str) -> None:
    """Install the package with pip."""
    print(f"[*] {package} not found. Installing…")
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--upgrade", package],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )
        print(f"[+] Successfully installed {package}")
    except subprocess.CalledProcessError as e:
        print(f"[!] Failed to install {package}: {e}")
        sys.exit(1)


def ensure_dependencies() -> None:
    """Install meta-ai-api (and its deps) if needed."""
    if not is_installed(IMPORT_NAME):
        install_package(PACKAGE)
    else:
        print(f"[+] {PACKAGE} is already installed")


def chat() -> None:
    """Start an interactive conversation with Meta AI."""
    from meta_ai_api import MetaAI

    print("\n" + "=" * 50)
    print("  Meta AI Chat  (type 'exit', 'quit' or Ctrl+C to leave)")
    print("=" * 50 + "\n")

    ai = MetaAI()

    while True:
        try:
            user_input = input("You: ").strip()
            if not user_input:
                continue
            if user_input.lower() in {"exit", "quit", "q"}:
                print("\nGoodbye!")
                break

            print("Meta AI: ", end="", flush=True)
            response = ai.prompt(message=user_input, stream=True)

            full_message = ""
            for chunk in response:
                msg = chunk.get("message", "")
                # Only print the new part of the streamed message
                if msg.startswith(full_message):
                    new_part = msg[len(full_message):]
                    print(new_part, end="", flush=True)
                    full_message = msg
                else:
                    print(msg, end="", flush=True)
                    full_message = msg
            print("\n")

        except KeyboardInterrupt:
            print("\n\nGoodbye!")
            break
        except Exception as e:
            print(f"\n[!] Error: {e}\n")


if __name__ == "__main__":
    ensure_dependencies()
    chat()

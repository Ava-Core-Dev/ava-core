# Tkinter Methods Added Outside App Class

## Symptom

AVA Core Visual CLI fails to launch with:

    AttributeError: '_tkinter.tkapp' object has no attribute 'enable_ssh'

The traceback points to a Tkinter widget using:

    command=self.enable_ssh

## Cause

Methods intended to belong to:

    class App(tk.Tk):

were inserted outside the class/module boundary.

Python can still successfully compile the file because the syntax is valid,
but the resulting `App` class does not contain the methods.

## Detection

Compilation alone is NOT sufficient.

Use Python AST inspection:

    import ast

    tree = ast.parse(open("ava_core_visual_cli.py").read())
    app = next(
        n for n in tree.body
        if isinstance(n, ast.ClassDef) and n.name == "App"
    )

Then verify required methods exist in `app.body`.

## Fix

Move the methods into the App class before the class dedents.

Verify with AST rather than relying only on line numbers.

## Required Verification

    python3 -m py_compile ava_core_visual_cli.py

Then verify:

- ssh_command is a member of App
- refresh_ssh is a member of App
- enable_ssh is a member of App
- disable_ssh is a member of App
- App().mainloop() exists

Finally launch the application.

## Prevention

When automatically modifying Python classes:

1. Parse the file with AST.
2. Identify the target class.
3. Identify the target methods.
4. Insert methods relative to the class AST boundaries.
5. Compile.
6. Perform AST membership verification.
7. Launch-test the application.

Do not assume a module uses:

    if __name__ == "__main__":

when the actual launcher is different.

## Incident

2026-08-23 — SSH Mode integration into AVA Core Visual CLI.

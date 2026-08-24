# Python Compile Success Does Not Mean Application Success

## Symptom

    python3 -m py_compile file.py

returns success, but the application crashes when launched.

## Cause

Compilation checks syntax/bytecode generation. It does not verify:

- Class membership
- Runtime attribute availability
- Tkinter widget callbacks
- Missing runtime resources
- Service availability
- Application initialization

## Example

A method can exist syntactically in the file but outside the intended class.

The file compiles, but:

    self.some_method

can fail at runtime.

## Prevention

For application modifications use multiple validation layers:

1. Syntax/compile check
2. AST structure check where appropriate
3. Direct runtime launch
4. Functional test


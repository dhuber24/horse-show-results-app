"""Every call between this app's own functions matches what the function takes.

Python only finds out when the line runs, and nothing here checks types:
`compileall` passes regardless. `_out` in `routers/my_company.py` grew an argument
(migration 179), its one caller in another file was missed, and Setup Step 1's
Staff section answered 500 at every show with a company, with every test green.

So this reads the source and binds each call to the signature of the function it
names: a bare name defined or imported from this app, or `module.name` on one of
this app's modules. It knows nothing about types, only that the arguments fit.
"""
import ast
import importlib
import inspect
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
# `main` builds the running app; nothing calls into it.
SOURCES = sorted(p for p in BACKEND.glob("*.py") if p.stem != "main") + sorted((BACKEND / "routers").glob("*.py"))
PROJECT = {p.stem for p in SOURCES} | {f"routers.{p.stem}" for p in (BACKEND / "routers").glob("*.py")} | {"routers"}


def _module_name(path: Path) -> str:
    return f"routers.{path.stem}" if path.parent.name == "routers" else path.stem


def _functions_in_scope(tree: ast.Module, module) -> dict:
    """What a bare name means in this file, wherever the import sits: lazy imports
    inside a function are how this app breaks import cycles."""
    found = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            found[node.name] = getattr(module, node.name, None)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and not node.level and node.module in PROJECT:
            source = importlib.import_module(node.module)
            for alias in node.names:
                found[alias.asname or alias.name] = getattr(source, alias.name, None)
    return {name: fn for name, fn in found.items() if inspect.isfunction(fn)}


def _modules_in_scope(tree: ast.Module) -> dict:
    found = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in PROJECT:
                    found[alias.asname or alias.name] = importlib.import_module(alias.name)
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module == "routers":
            for alias in node.names:
                found[alias.asname or alias.name] = importlib.import_module(f"routers.{alias.name}")
    return found


def _rebound_names(function: ast.AST) -> set[str]:
    """Names a function uses for something else: its parameters and assignments."""
    names = set()
    if isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        names |= {a.arg for a in [*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs]}
    for node in ast.walk(function):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            names.add(node.id)
    return names


def _calls_with_their_function(tree: ast.Module):
    """Each call, with the names rebound by the functions around it."""
    def walk(node, rebound):
        for child in ast.iter_child_nodes(node):
            inner = rebound
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                inner = rebound | _rebound_names(child)
            if isinstance(child, ast.Call):
                yield child, inner
            yield from walk(child, inner)

    yield from walk(tree, set())


def _mismatches(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    module = importlib.import_module(_module_name(path))
    functions = _functions_in_scope(tree, module)
    modules = _modules_in_scope(tree)
    problems = []
    for call, rebound in _calls_with_their_function(tree):
        target = None
        if isinstance(call.func, ast.Name) and call.func.id not in rebound:
            target = functions.get(call.func.id)
        elif isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name):
            source = modules.get(call.func.value.id)
            if source is not None and call.func.value.id not in rebound:
                target = getattr(source, call.func.attr, None)
        if not inspect.isfunction(target):
            continue
        # `f(*args)` and `f(**kwargs)` can't be judged from the source.
        if any(isinstance(a, ast.Starred) for a in call.args) or any(k.arg is None for k in call.keywords):
            continue
        try:
            inspect.signature(target).bind(*[None] * len(call.args), **{k.arg: None for k in call.keywords})
        except TypeError as exc:
            problems.append(f"{path.name}:{call.lineno} {target.__name__}(): {exc}")
    return problems


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: _module_name(p))
def test_every_call_fits_what_the_function_takes(path):
    assert _mismatches(path) == []


def test_this_check_would_have_caught_the_call_that_broke_step_one(tmp_path, monkeypatch):
    """A check that finds nothing has to be able to find something."""
    monkeypatch.syspath_prepend(str(tmp_path))
    (tmp_path / "zz_signature_helper.py").write_text("def payload(company, caller, prices):\n    return None\n")
    source = tmp_path / "zz_signature_caller.py"
    source.write_text(
        "from zz_signature_helper import payload\n"
        "def fine(company, caller):\n    return payload(company, caller, 1)\n"
        "def broken(company, caller):\n    return payload(company, caller)\n"
    )
    monkeypatch.setitem(globals(), "PROJECT", PROJECT | {"zz_signature_helper"})
    monkeypatch.setitem(globals(), "_module_name", lambda path: path.stem)
    problems = _mismatches(source)
    assert len(problems) == 1 and "zz_signature_caller.py:5" in problems[0]

"""Harrier's own parser. Invoked with python3 -I; never imports reviewed modules."""
import ast
import json
import sys


def inspect(source):
    tree = ast.parse(source)
    aliases = {}
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for item in node.names:
                aliases[item.asname or item.name.split('.')[0]] = item.name if item.asname else item.name.split('.')[0]
                imports.append({'name': item.name, 'level': 0, 'line': node.lineno})
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ''
            for item in node.names:
                name = '.'.join(filter(None, [module, item.name]))
                aliases[item.asname or item.name] = name
                imports.append({'name': name, 'level': node.level, 'line': node.lineno})
    def name_of(node):
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            base = name_of(node.value)
            return (base + '.' if base else '') + node.attr
        return ''
    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = name_of(node.func)
            head, _, tail = name.partition('.')
            resolved = aliases.get(head, head) + ('.' + tail if tail else '')
            calls.append({'name': name, 'resolved': resolved, 'line': node.lineno})
    return {'calls': calls, 'imports': imports}

try:
    print(json.dumps(inspect(sys.stdin.read())))
except (SyntaxError, ValueError) as exc:
    print(json.dumps({'error': str(exc)}))
    sys.exit(2)

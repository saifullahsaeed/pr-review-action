"""Count exact BPE text tokens for a deliberately small model allowlist, offline only."""
import json
import sys

try:
    import tiktoken
    import tiktoken.load
    # tiktoken may fetch encoding files on first use. Harrier must never do that implicitly.
    original = tiktoken.load.read_file
    def local_only(path):
        if path.startswith(('http://', 'https://')):
            raise RuntimeError('Tokenizer data is not cached; preload tiktoken data explicitly')
        return original(path)
    tiktoken.load.read_file = local_only
    data = json.load(sys.stdin)
    models = {
        'gpt-4o': 'o200k_base', 'gpt-4o-2024-08-06': 'o200k_base',
        'gpt-4o-mini': 'o200k_base', 'gpt-4o-mini-2024-07-18': 'o200k_base',
        'gpt-4-turbo': 'cl100k_base', 'gpt-4-turbo-2024-04-09': 'cl100k_base',
    }
    model = data['model'].removeprefix('openai/')
    if model not in models:
        raise ValueError('Unsupported exact tokenizer model: ' + model)
    encoding = tiktoken.get_encoding(models[model])
    counts = [len(encoding.encode(message['content'], disallowed_special=())) for message in data['messages']]
    print(json.dumps({'textTokens': sum(counts), 'encoding': models[model]}))
except Exception as exc:
    print(json.dumps({'error': str(exc)}))
    sys.exit(2)

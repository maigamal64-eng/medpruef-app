# Anthropic wrapper fixtures

These are SYNTHESIZED from the documented Messages API shapes (claude-api skill
and platform.claude.com docs, read 2026-10-10). They are not live recordings:
no working production key was available in wave 0. Replace them with real
recordings once [name]'s key is confirmed (acceptance item "confirmed with the
Models API once [name]'s working key exists").

- `messages-thinking-first.json`: non-streaming reply whose content[0] is a
  thinking block with `display: "omitted"` (empty thinking text, signature
  present), as Sonnet 5.x / Haiku 5.5 return by default. The reply text is in
  content[1]. This is the shape that broke /api/ai-chat after 29 Aug 2026.
- `stream-thinking-first.sse`: the same pattern as a server-sent-events stream
  (message_start usage first, thinking block, text deltas with multibyte text,
  cumulative message_delta usage, message_stop).

#!/usr/bin/env bash
# Controlled A/B/C test for phone number normalization approaches.
# Tests A, B, D on the exact STT strings from the failed Round 3.
#
# Usage: ./test-phone-fixes.sh

set -euo pipefail

cd "$(dirname "$0")"

echo "=== TESTING APPROACH A (Post-STT normalization) ==="
python3 << 'PY'
import re

# The exact STT outputs Deepgram returned for Round 3 call CA26b256c866a3abdf2c8bf7463f8dd079
test_cases = [
    # (stt_input, expected_canonical, description)
    ("My name is Alex Morgan, and my phone number is 5 5 5 5 0 0 4 7.", "55550047", "Round 3, turn 10"),
    ("Actually, it's 5 5 5 even y 1 4 7, not 5 5 5 5 4 7. But, yes, that's correct.", "5550147", "Round 3, turn 12 (correction)"),
    ("Yeah. Of course. It's 5 5 5 0 1 4 7 5 5 5 0 1 4 7.", "5550147", "Round 3, turn 14 (repeats number)"),
    ("5 5 5 0 1 4 7.", "5550147", "Round 3, turn 16"),
    ("Alex Morgan and 5 35 0 1 4 7.", "5550147", "Round 1, turn 10 (bogus 535)"),
    ("Yes, that's correct.", None, "Standard confirmation — no phone"),
]

def normalize_approach_a(text):
    """Post-STT: strip all non-digit characters, collapse consecutive digit sequences"""
    # Find sequences of digits (possibly with spaces), collapse them
    # A bit risky: might mangle "call me at 5 5 5 0 1 4 7 tomorrow at 3"
    digits = re.findall(r'\d+(?:\s+\d+)*', text)
    if not digits:
        return None
    # Collapse each group, take the longest one as the phone number
    candidates = [''.join(d.replace(' ', '')) for d in digits]
    return max(candidates, key=len) if candidates else None

def normalize_approach_b(text):
    """Regex extraction: look for patterns that look like phone numbers"""
    # Strip all spaces between digits first, then look for 7+ digit sequences
    clean = re.sub(r'(?<=\d)\s+(?=\d)', '', text)
    # Find digit sequences of 7-11 digits
    matches = re.findall(r'\b\d{7,11}\b', clean)
    if matches:
        return matches[0]  # first match
    # Fallback: any digit sequence
    matches = re.findall(r'\d+', clean)
    if matches:
        return ''.join(matches)
    return None

for stt, expected, desc in test_cases:
    a = normalize_approach_a(stt)
    b = normalize_approach_b(stt)
    a_ok = a == expected
    b_ok = b == expected
    print(f"{desc}")
    print(f"  STT: '{stt[:60]}...'")
    print(f"  Expected: {expected}")
    print(f"  A: {a} {'✅' if a_ok else '❌'}")
    print(f"  B: {b} {'✅' if b_ok else '❌'}")
    print()
PY

echo ""
echo "=== TESTING APPROACH D (Prompt-only: stronger instructions) ==="
echo "(This requires live calls — below are the prompt changes only)"
echo ""
echo "Current prompt (line ~3478):"
grep -A2 "When reading a phone number back" /Users/sushanthtiruvaipati/Documents/GitHub/realtime-tts/call-loop-poc/server.js | head -3

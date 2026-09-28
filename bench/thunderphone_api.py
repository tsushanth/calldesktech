#!/usr/bin/env python3
"""
ThunderPhone REST API helper for benchmarking.
Thin wrapper around api.thunderphone.com/v1/* for the operations a benchmark
harness needs: agent CRUD, number assignment, call listing/transcript retrieval.

Endpoint availability verified via HTTP probe (401 = real endpoint, 404 = not real).
Confirmed real: /v1/agents, /v1/calls, /v1/campaigns, /v1/integrations,
                /v1/voices, /v1/phone-numbers
"""
import json
import os
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE = os.environ.get("THUNDERPHONE_API_BASE", "https://api.thunderphone.com")
TOKEN = os.environ.get("THUNDERPHONE_API_KEY", "")


def _req(method, path, data=None, query=None):
    url = f"{BASE}{path}"
    if query:
        url += "?" + urlencode(query)
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    body = json.dumps(data).encode() if data else None
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            if not raw.strip():
                return None
            return json.loads(raw)
    except HTTPError as e:
        text = e.read().decode()
        try:
            detail = json.loads(text)
        except Exception:
            detail = text
        raise RuntimeError(f"ThunderPhone API {method} {path} -> {e.code}: {detail}") from e


def list_agents():
    """List all agents in the organization."""
    return _req("GET", "/v1/agents")


def create_agent(name, prompt, voice="john", product="spark", primary_language="en"):
    """
    Create a ThunderPhone agent.
    product: spark | bolt | storm
    voice: name from list_voices() (e.g. "john", "maya", "sofia")
    primary_language: ISO code (e.g. "en", "es", "fr")
    """
    payload = {
        "name": name,
        "prompt": prompt,
        "product": product,
        "voice": voice,
        "primary_language": primary_language,
    }
    return _req("POST", "/v1/agents", payload)


def get_agent(agent_id):
    return _req("GET", f"/v1/agents/{agent_id}")


def delete_agent(agent_id):
    return _req("DELETE", f"/v1/agents/{agent_id}")


def list_phone_numbers():
    return _req("GET", "/v1/phone-numbers")


def assign_agent_to_number(phone_number_id, agent_id):
    """
    Point a ThunderPhone number at an agent.
    """
    payload = {
        "inbound_agent_id": agent_id
    }
    return _req("PATCH", f"/v1/phone-numbers/{phone_number_id}", payload)


def list_calls(agent_id=None, from_number=None, start_after=None, start_before=None, limit=10):
    """
    List calls with optional filters. Timestamp filters are Unix ms.
    """
    q = {"limit": limit}
    if agent_id:
        q["agent_id"] = agent_id
    if from_number:
        q["from_number"] = from_number
    if start_after:
        q["start_timestamp[gte]"] = start_after
    if start_before:
        q["start_timestamp[lte]"] = start_before
    return _req("GET", "/v1/calls", query=q)


def get_call(call_id):
    return _req("GET", f"/v1/calls/{call_id}")


def get_call_transcript(call_id):
    """
    Fetch transcript and return as normalized text (Business: / Customer: lines).
    Handles both dict-with-transcripts and raw-string formats.
    """
    call = get_call(call_id)
    rec = call.get("recording", {})
    raw = None
    if "transcript" in rec:
        raw = rec["transcript"]
    elif "transcript" in call:
        raw = call["transcript"]
    else:
        raw = _req("GET", f"/v1/calls/{call_id}/transcript")

    # Normalize to text
    if isinstance(raw, dict) and "transcripts" in raw:
        lines = []
        for turn in raw["transcripts"]:
            role = turn.get("role", "")
            content = turn.get("content", "")
            label = "Business" if role == "agent" else "Customer" if role == "user" else role.capitalize()
            lines.append(f'{label}: "{content}"')
        return "\n".join(lines)
    if isinstance(raw, list):
        lines = []
        for turn in raw:
            role = turn.get("role", "")
            content = turn.get("content", "")
            label = "Business" if role == "agent" else "Customer" if role == "user" else role.capitalize()
            lines.append(f'{label}: "{content}"')
        return "\n".join(lines)
    if isinstance(raw, str):
        return raw
    return str(raw)


def list_voices():
    return _req("GET", "/v1/voices")


def find_call_by_time_window(agent_id, from_number, window_start_ms, window_end_ms):
    """
    Find the single most recent call matching the agent + from_number + time window.
    Returns the call object or raises if none/many.
    """
    params = {
        "agent_id": agent_id,
        "from_number": from_number,
        "start_after": window_start_ms,
        "start_before": window_end_ms,
        "limit": 5,
    }
    resp = list_calls(**params)
    items = resp if isinstance(resp, list) else resp.get("calls", resp.get("items", resp.get("results", [])))
    if not items:
        raise RuntimeError("No ThunderPhone call found in window")
    if len(items) > 1:
        items = sorted(items, key=lambda c: c.get("start_timestamp", c.get("created_at", c.get("timestamp", 0))), reverse=True)
    return items[0]


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else None
    if cmd == "list-agents":
        print(json.dumps(list_agents(), indent=2))
    elif cmd == "list-voices":
        print(json.dumps(list_voices(), indent=2))
    elif cmd == "list-numbers":
        print(json.dumps(list_phone_numbers(), indent=2))
    elif cmd == "health":
        try:
            list_agents()
            print("OK")
        except Exception as e:
            print(f"FAIL: {e}")
            sys.exit(1)
    else:
        print(f"Usage: {sys.argv[0]} list-agents|list-voices|list-numbers|health")
        sys.exit(1)

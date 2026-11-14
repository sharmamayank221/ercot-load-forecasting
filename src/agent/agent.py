"""Grid-analyst agent: a tool-calling LLM over the trained models and data.

Run:  python -m src.agent.agent "Will North Central demand break 29,000 MW on 2026-07-22?"

Backends (set LLM_PROVIDER in .env):
  ollama    local, free:  brew install ollama; ollama pull qwen2.5:7b;  pip install langchain-ollama
            (model from OLLAMA_MODEL, default qwen2.5:7b; must be a tool-calling model)
  anthropic cloud:        pip install langchain-anthropic; ANTHROPIC_API_KEY in .env
Default is ollama if no ANTHROPIC_API_KEY is set.
"""
import json
import os
import sys

from langchain_core.tools import tool

try:
    from langchain.agents import create_agent as create_react_agent
except ImportError:
    from langgraph.prebuilt import create_react_agent

from src.agent.tools import PLAIN_TOOLS

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

SYSTEM = """You are a grid-operations analyst for ERCOT, the Texas power grid.
Answer questions about electricity demand using ONLY the tools provided.
Rules:
- Every number you state must come from a tool result in this conversation. Never estimate.
- Say which tools you used, e.g. "(from forecast_load and get_weather)".
- Zones: Coast, East, Far West, North, North Central, South Central, Southern, West.
- Dates are in Central time; the data covers Jan 2018 to early Nov 2026. If a date is outside
  that range, say so instead of guessing.
- Keep answers short: the key numbers, one sentence of interpretation, the tools used."""


def build_llm(model_name=None):
    provider = os.environ.get("LLM_PROVIDER") or ("anthropic" if os.environ.get("ANTHROPIC_API_KEY") else "ollama")
    if provider == "ollama":
        try:
            from langchain_ollama import ChatOllama
        except ImportError as e:
            raise SystemExit("pip install langchain-ollama") from e
        return ChatOllama(model=model_name or os.environ.get("OLLAMA_MODEL", "qwen2.5:7b"),
                          temperature=0, num_ctx=8192)
    try:
        from langchain_anthropic import ChatAnthropic
    except ImportError as e:
        raise SystemExit("pip install langchain-anthropic") from e
    return ChatAnthropic(model=model_name or "claude-sonnet-4-6", temperature=0)


def build_agent(model_name=None):
    tools = [tool(f) for f in PLAIN_TOOLS]
    return create_react_agent(build_llm(model_name), tools, system_prompt=SYSTEM)


def ask(question, agent=None):
    agent = agent or build_agent()
    result = agent.invoke({"messages": [("user", question)]})
    msgs = result["messages"]
    used = [m.name for m in msgs if getattr(m, "type", "") == "tool"]
    return msgs[-1].content, used


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv; load_dotenv()
    except ImportError:
        pass
    q = " ".join(sys.argv[1:]) or "What was the Coast zone peak on 2026-07-22 and how far off was the forecast?"
    answer, used = ask(q)
    print(answer, "\n\ntools called:", used)

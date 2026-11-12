"""Grid-analyst agent: a tool-calling LLM over the trained models and data.

Run:  python -m src.agent.agent "Will North Central demand break 29,000 MW on 2026-07-22?"
Needs: pip install langchain langchain-anthropic langgraph   and   ANTHROPIC_API_KEY in .env
"""
import json
import os
import sys

from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from src.agent.tools import PLAIN_TOOLS

SYSTEM = """You are a grid-operations analyst for ERCOT, the Texas power grid.
Answer questions about electricity demand using ONLY the tools provided.
Rules:
- Every number you state must come from a tool result in this conversation. Never estimate.
- Say which tools you used, e.g. "(from forecast_load and get_weather)".
- Zones: Coast, East, Far West, North, North Central, South Central, Southern, West.
- Dates are in Central time; the data covers Jan 2018 to early Nov 2026. If a date is outside
  that range, say so instead of guessing.
- Keep answers short: the key numbers, one sentence of interpretation, the tools used."""


def build_agent(model_name=None):
    try:
        from langchain_anthropic import ChatAnthropic
        llm = ChatAnthropic(model=model_name or "claude-sonnet-4-6", temperature=0)
    except ImportError as e:
        raise SystemExit("pip install langchain-anthropic") from e
    tools = [tool(f) for f in PLAIN_TOOLS]
    return create_react_agent(llm, tools, prompt=SYSTEM)


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
    if "ANTHROPIC_API_KEY" not in os.environ:
        sys.exit("set ANTHROPIC_API_KEY in .env or the environment")
    q = " ".join(sys.argv[1:]) or "What was the Coast zone peak on 2026-07-22 and how far off was the forecast?"
    answer, used = ask(q)
    print(answer, "\n\ntools called:", used)

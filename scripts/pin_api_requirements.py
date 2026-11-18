"""Write requirements-api.txt with the exact library versions installed on THIS machine.

The saved models are pickles: the server must load them with the same scikit-learn and
XGBoost versions that trained them, or they may fail to load or predict differently.
Run:  python scripts/pin_api_requirements.py
"""
from importlib.metadata import version

pkgs = ["pandas", "numpy", "pyarrow", "scikit-learn", "xgboost", "joblib", "holidays",
        "fastapi", "uvicorn", "python-dotenv"]
lines = [f"{p}=={version(p)}" for p in pkgs]
# agent libraries: only used by /api/agent; unpinned is fine
lines += ["langchain", "langchain-core", "langgraph", "langchain-anthropic", "langchain-groq"]
open("requirements-api.txt", "w").write("\n".join(lines) + "\n")
print("\n".join(lines))

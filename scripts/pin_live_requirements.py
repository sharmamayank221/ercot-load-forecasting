"""Write requirements-live.txt for the daily GitHub Actions job, pinned to THIS machine's versions.

The saved models are pickles, so the job must load them with the same scikit-learn and XGBoost
that trained them. Run this on the Mac that trained the models:   python scripts/pin_live_requirements.py
"""
import sys
from importlib.metadata import version

pinned = ["pandas", "numpy", "pyarrow", "scikit-learn", "xgboost", "joblib", "holidays", "requests",
          "fastapi", "pydantic", "python-dotenv"]
lines = [f"{p}=={version(p)}" for p in pinned] + ["meteostat<2"]
open("requirements-live.txt", "w").write("\n".join(lines) + "\n")
print("\n".join(lines))
print(f"\nThis machine runs Python {sys.version_info.major}.{sys.version_info.minor}; "
      "set the same python-version in .github/workflows/daily-refresh.yml.")

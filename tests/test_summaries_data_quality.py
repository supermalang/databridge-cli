import pandas as pd
from src.reports.summaries import _data_quality_text


def test_data_quality_uses_3x_iqr():
    # 20 is outside 1.5×IQR but inside 3×IQR for this spread → must NOT be flagged at 3×
    # [10..15, 20]: Q1=11.5, Q3=14.5, IQR=3.0 → 1.5× upper=19.0, 3× upper=23.5
    df = pd.DataFrame({"V": [10, 11, 12, 13, 14, 15, 20]})
    text = _data_quality_text(df, ["V"])
    assert "Outliers (IQR)" not in text

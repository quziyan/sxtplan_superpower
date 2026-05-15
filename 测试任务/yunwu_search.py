'''
Description: 
version: 
Author: QuZhi
Date: 2026-05-13 15:53:01
LastEditors: QuZhi
LastEditTime: 2026-05-13 16:11:01
'''
#!/usr/bin/env python3
"""Yunwu DR 搜索脚本 — OpenAI 兼容调用。

用法:
  python yunwu_search.py "你的问题"
  echo "你的问题" | python yunwu_search.py
  python yunwu_search.py            # 进入交互模式
"""

import sys
from openai import OpenAI

BASE_URL = "https://yunwu.ai/v1"
API_KEY = "sk-AeHrHKOGxLf5YQAY5y0mgwEuRvFjWdzmUpW460Gkebc0rBOa"
MODEL_NAME = "gpt-5.1-all"

QUESTION = (
    "请以列表的 json 格式输出：2026 年 6 月，广州将举行哪些大型活动？"
    "要求 json 列表中每一项都含以下字段："
    "活动名称、时间、地点、活动规模。"
    "输出示例："
    "[{\"活动名称\": \"xxx\", \"时间\": \"2026-06-xx\", \"地点\": \"xxx\", \"活动规模\": \"xxx\"}, ...]"
)

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)


def ask(question: str) -> None:
    stream = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": question}],
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            print(delta, end="", flush=True)
    print()


def main() -> None:
    if len(sys.argv) > 1:
        ask(" ".join(sys.argv[1:]))
        return
    if not sys.stdin.isatty():
        ask(sys.stdin.read().strip())
        return
    print("输入问题（空行退出）:")
    while True:
        try:
            q = input("> ").strip()
            q = QUESTION
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not q:
            return
        ask(q)
        print()


if __name__ == "__main__":
    main()

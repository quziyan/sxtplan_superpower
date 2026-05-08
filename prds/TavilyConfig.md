<!--
 * @Description: 
 * @version: 
 * @Author: QuZhi
 * @Date: 2026-05-08 11:24:11
 * @LastEditors: QuZhi
 * @LastEditTime: 2026-05-08 11:27:40
-->

API_KEY : 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

调用方式：

```
from tavily import TavilyClient

tavily_client = TavilyClient(api_key="tvly-YOUR_API_KEY")
response = tavily_client.search("Who is Leo Messi?")

print(response)
```
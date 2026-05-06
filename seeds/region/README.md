# 行政区划种子数据

需要的文件:`china-admin-l1-l4.geojson`

来源选项(按合规优先级):
1. 民政部全国行政区划查询平台公开数据(`http://xzqh.mca.gov.cn/`)— 推荐
2. 高德地图行政区划查询接口(申请商用授权后)
3. 开源 `geojson-map-china` 镜像(MIT 许可,验证后入)

格式要求:
- FeatureCollection
- Each Feature 必有 `properties.name`、`properties.adcode`、`properties.level` (1-4)
- `properties.parent_adcode` 表示行政父级 adcode

`bun run seed:region` 会做幂等导入(同 name+parent 跳过)。

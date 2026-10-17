# papercut-v1 算法与几何接口

2026-10-17：M04实现基线已确定，待阶段审核。基线来自M02验证公式；不代表人工签字或正式发布批准。geometryVersion、parameterVersion、rendererVersion、schemaVersion均为1。TemplateVersion.version是内容版本，不等同于算法版本；任意正整数内容版本仍须通过完整校验。

## 坐标和变换

单位方纸[0,1]²，原点左上，x向右、y向下。局部形状以参数包围框中心(0,0)为原点，width=w、height=h均为纸边长的比例。angleDeg范围[0,360)，在屏幕坐标中顺时针；先绕局部原点旋转，再平移到operation.center，最后应用纸张对称复制。

局部定位：x'=cx+x cosθ-y sinθ，y'=cy+x sinθ+y cosθ。旋转不改变保存的宽高含义。

## 原始形状（用于正式渲染）

- triangle：闭合直线三角形，依次(0,-h/2)、(-w/2,h/2)、(w/2,h/2)。
- circle：允许椭圆，x=(w/2)cos t、y=(h/2)sin t，t∈[0,2π]；不强制等宽高。
- teardrop：尖端向上，由两段三次贝塞尔闭合。左段P0=(0,-h/2)、P1=(-2w/3,0)、P2=(-2w/3,h/2)、P3=(0,h/2)；右段P0=(0,h/2)、P1=(2w/3,h/2)、P2=(2w/3,0)、P3=(0,-h/2)。B(t)=(1-t)³P0+3(1-t)²tP1+3(1-t)t²P2+t³P3。t=.5时x为±w/2、y=3h/16；上下界为±h/2。因此宽高确实为未旋转包围框尺寸，center不是水滴面积重心。

## 基础域、复制与镂空

vertical基础域[0,.5]×[0,1]；原切口完整在此域内，展开副本依次恒等、x'=1-x/y'=y。

radial/4/mirror=false基础域[.5,1]×[.5,1]，从向右到向下90°；绕(.5,.5)依次旋转0/90/180/270°。完整纸张点的变换依次为(x,y)、(1-y,x)、(1-x,1-y)、(y,1-x)，实现使用精确整数系数矩阵。

allowedRegion是模板另设的非退化凸多边形，按路径顺序闭合，顺/逆时针均可。原切口完整轮廓必须同时在allowedRegion与基础域内。允许共线冗余点，但不允许零面积、重复顶点、交叉或凹多边形。每条有向边的内侧半平面必须包含其他所有顶点；配合重复点和面积检查拒绝非法区域。

真实纸边只有x=0、x=1、y=0、y=1。基础域分界是折叠边，allowedRegion边是参数约束边，两者均不额外施加minEdgeGap。minEdgeGap只约束**对称复制后**切口到真实纸边的距离；方纸可用每个副本轮廓点的四向坐标判断。切口可触碰折叠边，但不可跨越；复制或多次剪切重叠取镂空并集，渲染器须保持该语义，不以奇偶填充把重叠部分填回。

## 保守校验与误差

所有容差集中于geometry.ts的GEOMETRY_TOLERANCES：boundary=1e-10纸边单位，polygonArea=1e-10（二倍有向面积阈值），curveFlatness=1e-5，curveMaxDepth=16，ellipseSides=128。半平面比较将叉积容差乘边长，因此boundary是距离容差，仅吸收浮点舍入。

三角使用精确三个顶点。椭圆使用128边外切多边形，角度为(i+.5)2π/128，半径倍率sec(π/128)。这是单位圆外切多边形经非均匀缩放所得，包含整个椭圆。最大参数径向外扩≤max(w,h)/2·(sec(π/128)-1)，全schema尺寸范围内≤0.000151；本模板可进一步收紧尺寸。

水滴使用de Casteljau二分；每段两个中间控制点到端点弦所在直线的距离≤1e-5时保留四个控制点，否则继续细分。返回的是各叶段控制凸包的全部生成点集合，**不是按路径排列的渲染多边形**；凸半平面包含全部控制点即可保守包含曲线。平直度限制描述相对弦线的横向偏差；不能视为任意曲线的精确Hausdorff距离。达到深度16仍不满足时返回GEOMETRY_INVALID和字段路径，不静默改用粗糙折线。

保守点先定位旋转，再校验区域/基础域，并对每个对称副本校验真实纸边间距。曲线靠近边界时可能被保守拒绝；这不是精确曲线距离判定，也不允许将保守轮廓当成正式渲染数据。原始曲线和近似数据分开输出。超出boundary容差的轮廓一律拒绝。

## 支持矩阵与错误

| 配置 | v1实现 | 失败语义 |
| --- | --- | --- |
| square + reflection/vertical | 支持 | — |
| square + radial/4/mirror=false | 支持 | — |
| triangle / circle椭圆 / teardrop | 支持，仍受模板allowedCuts和尺寸约束 | GEOMETRY_INVALID或结构INVALID_INPUT |
| circle纸张 | 不支持 | UNSUPPORTED_VERSION，明确方纸限制 |
| horizontal / both | 不支持 | UNSUPPORTED_VERSION，说明支持组合 |
| radial/6、8或mirror=true | 不支持 | UNSUPPORTED_VERSION，说明支持组合 |
| 非退化凸allowedRegion，顺/逆时针 | 支持 | — |
| 非凸/退化/交叉/重复顶点区域 | 不支持 | GEOMETRY_INVALID，定位allowedRegion |
| 未知正整数算法/数据版本 | 不支持 | UNSUPPORTED_VERSION |
| 缺失或类型损坏的版本字段 | 非法输入 | INVALID_INPUT |

公共schema允许的配置不等于算法已支持。操作ID唯一、order从0连续、数量≤模板上限且≤100；所有schema、业务与几何检查均成功才创建状态或写历史。未知版本恢复失败须保留原记录，不自动迁移或按新算法重画。

## 公开几何接口（包内版本1）

`getWorkGeometry(input: unknown): Result<WorkGeometry, CoreError>`对完整Work执行正式校验后输出独立纯数据；无SVG/XML/DOM/Canvas、时钟、ID生成或存储。所有坐标长度均为纸边单位。

- geometryVersion=1、unit='paper-side'、overlap='union'。
- cuts保持operation顺序；operationId用于调用方关联；localShape为polygon(vertices)、ellipse(radiusX/radiusY)或cubic-loop(curves)，每条curve按[P0,P1,P2,P3]排列。
- placement是局部→纸张的仿射矩阵；symmetryTransforms是纸张→副本的仿射矩阵，含恒等矩阵。统一约定x'=a*x+c*y+e、y'=b*x+d*y+f。组合顺序为symmetry(placement(localPoint))。M06可按此顺序创建渲染变换，无需重推水滴或对称公式。
- conservativeContour仅用于校验，已经应用placement，尚未应用symmetry；它不是localShape的替代。
- baseDomain为纸张坐标下的闭合多边形顶点，不重复末点；用于折叠视图，不是allowedRegion替代。

M06正式渲染应使用原始localShape曲线及矩阵；不调用内部模块，也不复制公式。黄金样例见packages/papercut-core/src/test-data.ts及core.test.ts，包含手算控制点、定位和四扇区副本。

## 历史和恢复

createState先校验并复制Work，历史为空；模板切换必须创建新状态。dispatch先校验当前Work及undo/redo中每份Work，并验证id、craftId与整个模板快照深值相同（不依赖对象键顺序），拒绝跨作品/模板历史。每个方向最多30份快照，超过上限的外部状态视为非法；有效编辑保留最近30步。

剪切和配色参与撤销重做。恢复时只取历史的operations和palette，其他字段全部来自当前Work：id/name/craftId/templateSnapshot/revision/createdAt/updatedAt/status/schemaVersion均不被旧快照覆盖。核心不重命名、不保存、不更新时间或revision。调用方可替换state.work为保存结果并保留历史，只要作品身份和模板未改变；不同作品/模板应createState。

有效新剪切/不同配色清空redo；相同配色、空undo、空redo成功无操作，返回独立数据，不增加历史、不清空redo。失败不修改输入或任意历史。各成功结果的当前作品、历史项和调用方输入没有可变嵌套引用共享。

此模块是数字模拟：不保证剩余纸张连通、真实刀路或实体可剪性；不承担SVG多实例标识、迁移、自动草稿、存储恢复或发布审核。正式发布后若改变本算法语义，必须采用新版本并保留旧实现或提供已验证迁移，禁止原位重解释旧作品。

## M04审核后历史校验性能修正（2026-10-17）

一次dispatch创建一个私有校验上下文，当前Work、全部undo/redo和待提交Work共用；结束后丢弃。每份Work仍执行完整WorkSchema、版本、数量、ID唯一/order连续、形状与尺寸检查，以及历史所属作品/完整模板快照比较，不把调用方对象身份视为已校验凭据。

几何成功结果仅按**schema解析后的完整模板值＋剪切几何参数值**复用。完整模板键使用JSON序列化（仅构造值键，不克隆或断言输入）；切口键包含parameterVersion/shape/center.x/center.y/width/height/angleDeg。id/order不影响几何，但仍逐Work校验。不同模板不共享判定；非法结果不缓存，保持真实字段路径。缓存只存成功键，不存或返回可变轮廓。下次dispatch重新构建上下文，所以任何调用方修改、伪造或反序列化的历史都重新按值检查。

此前几何成本随所有历史的切口总数累积；现在仅随本次调用中不同模板/几何参数组合数累积。历史结构检查、深值身份检查和独立结果复制仍与快照数据量相关。形状公式、保守近似、容差和公开接口均未改变。该优化不引入跨调用缓存、全局状态或时钟依赖。可复现测量、环境、原始样本及范围见M04交接中的审核后补充；不能用Node微测量替代正式浏览器输入至渲染验收。

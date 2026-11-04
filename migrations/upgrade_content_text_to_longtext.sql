-- 将 rag_contents 表的 content_text 字段从 TEXT 改为 LONGTEXT
-- 解决超过 64KB 文本内容无法保存的问题

USE jetlinks_knowledge;

-- 修改字段类型
ALTER TABLE rag_contents MODIFY COLUMN content_text LONGTEXT COMMENT '文本内容';

-- 查看修改结果
DESC rag_contents;

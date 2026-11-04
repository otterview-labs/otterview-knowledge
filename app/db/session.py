#!/usr/bin/env python
# -*- coding:utf-8 -*-
"""
数据库会话管理
"""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.config import settings
import logging

logger = logging.getLogger(__name__)

# 创建数据库引擎
engine = create_engine(
    settings.database.database_url,
    pool_pre_ping=True,
    pool_size=10,                    # 连接池大小
    max_overflow=20,                 # 最大溢出连接数
    pool_timeout=30,                 # 获取连接超时时间（秒）
    pool_recycle=3600,               # 连接回收时间（秒），1小时
    pool_reset_on_return='commit',   # 连接返回时重置方式
    echo=settings.database.SQLALCHEMY_ECHO
)

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_initial_data():
    """Automatic default-password administrators have been removed."""
    logger.info("请显式执行 scripts/create_admin_token.py 创建运行时管理员")

def test_db_connection():
    """测试数据库连接"""
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        logger.debug("数据库连接测试成功")
        return True
    except Exception as e:
        logger.error(f"数据库连接测试失败: {e}")
        return False 
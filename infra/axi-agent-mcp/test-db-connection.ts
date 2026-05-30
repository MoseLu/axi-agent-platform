/**
 * 数据库连接测试脚本
 */

import { DatabaseManager, loadDatabaseConfig } from './src/database/db-manager.js';

async function testDatabaseConnection() {
  console.log('🔍 开始测试数据库连接...\n');
  
  try {
    const config = loadDatabaseConfig();
    console.log('✅ 配置加载成功');
    console.log('   PostgreSQL:', config.postgresql.host, config.postgresql.database);
    console.log('   MongoDB:', config.mongodb.uri, config.mongodb.database);
    console.log('   Redis:', config.redis.host, config.redis.port);
    console.log('');
    
    const dbManager = new DatabaseManager(config);
    
    console.log('📡 尝试连接数据库...\n');
    
    // 测试 PostgreSQL
    try {
      await dbManager.connect();
      console.log('✅ 所有数据库连接成功！\n');
      
      const stats = dbManager.getStats();
      console.log('📊 连接状态:');
      console.log('   PostgreSQL:', stats.postgresql ? '✅' : '❌');
      console.log('   MongoDB:', stats.mongodb ? '✅' : '❌');
      console.log('   Redis:', stats.redis ? '✅' : '❌');
      
      await dbManager.disconnect();
    } catch (error) {
      console.log('❌ 连接失败:', error instanceof Error ? error.message : String(error));
      console.log('\n💡 可能的原因:');
      console.log('   1. 数据库服务未启动');
      console.log('   2. 密码不正确（当前配置：123456）');
      console.log('   3. 数据库不存在');
      console.log('\n💡 解决方案:');
      console.log('   1. 检查服务是否运行:');
      console.log('      - PostgreSQL: pg_ctl status');
      console.log('      - MongoDB: mongod --version');
      console.log('      - Redis: redis-cli ping');
      console.log('   2. 创建数据库:');
      console.log('      - PostgreSQL: CREATE DATABASE mcp_swarm;');
      console.log('      - MongoDB: 自动创建');
      console.log('      - Redis: 不需要创建');
    }
  } catch (error) {
    console.log('❌ 配置加载失败:', error instanceof Error ? error.message : String(error));
  }
}

testDatabaseConnection();

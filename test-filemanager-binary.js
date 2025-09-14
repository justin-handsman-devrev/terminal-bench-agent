#!/usr/bin/env node

// Test FileManager with binary files
const { FileManager } = require('./dist/agents/actions/file-manager');
const { LocalExecutor } = require('./dist/core/execution/command-executor');
const fs = require('fs');

async function testBinaryFile() {
  console.log('🧪 Testing FileManager with binary files');
  console.log('==========================================');
  
  const executor = new LocalExecutor();
  const fileManager = new FileManager(executor);
  
  // Create some test binary data (simulating a simple binary file)
  const binaryData = Buffer.from([
    0x50, 0x41, 0x52, 0x31, // PAR1 (Parquet magic bytes)
    0x00, 0x01, 0x02, 0x03,
    0xFF, 0xFE, 0xFD, 0xFC,
    0x50, 0x41, 0x52, 0x31  // PAR1 at end
  ]);
  
  const testFile = '/tmp/test-binary.bin';
  
  try {
    console.log('📝 Writing binary data...');
    const [writeResult, writeError] = await fileManager.writeFile(testFile, binaryData.toString('binary'));
    
    if (writeError) {
      console.error('❌ Write failed:', writeResult);
      return;
    }
    
    console.log('✅ Write result:', writeResult);
    
    // Read the file back and check if it matches
    console.log('📖 Reading file back...');
    const actualData = fs.readFileSync(testFile);
    
    console.log('Original length:', binaryData.length);
    console.log('Actual length:', actualData.length);
    console.log('Original hex:', binaryData.toString('hex'));
    console.log('Actual hex:', actualData.toString('hex'));
    
    if (Buffer.compare(binaryData, actualData) === 0) {
      console.log('✅ Binary data matches perfectly!');
    } else {
      console.log('❌ Binary data does NOT match!');
      console.log('First 16 bytes original:', Array.from(binaryData.slice(0, 16)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
      console.log('First 16 bytes actual:  ', Array.from(actualData.slice(0, 16)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up
    try {
      fs.unlinkSync(testFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

testBinaryFile().catch(console.error);

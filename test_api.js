const http = require('http');
const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
const adminHeaders = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};

const runTest = async () => {
  // Test 1: Valid payload
  const validPayload = {
    title: 'Test Quiz',
    questions: Array.from({ length: 5 }, (_, i) => ({
      prompt: `Q${i+1}`,
      sentence: 'test',
      choices: ['A', 'B', 'C'],
      correctIndex: 0,
      explanation: 'because'
    }))
  };

  const res1 = await fetch('http://localhost:3000/api/quizzes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders },
    body: JSON.stringify(validPayload)
  });
  console.log('Test 1 (Valid):', res1.status, await res1.json());

  // Test 2: Invalid 2 choices 
  const invalidPayload = {
    title: 'Test Quiz',
    questions: Array.from({ length: 5 }, (_, i) => ({
      prompt: `Q${i+1}`,
      sentence: 'test',
      choices: ['A', 'B'], // Only 2 choices
      correctIndex: 0,
      explanation: 'because'
    }))
  };

  const res2 = await fetch('http://localhost:3000/api/quizzes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders },
    body: JSON.stringify(invalidPayload)
  });
  console.log('Test 2 (Invalid 2 choices):', res2.status, await res2.json());

};

runTest();

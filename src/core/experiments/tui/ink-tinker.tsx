import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { marked } from 'marked';
// @ts-ignore
import { markedTerminal } from 'marked-terminal';

// Initialize marked with terminal renderer
marked.use(markedTerminal());

const SAMPLE_MARKDOWN = `### Micro-Database Spec
* Status: **Active**
* Project: \`bagelwerk\`

\`\`\`typescript
// Inline code highlighting test
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`
`;

interface MenuItem {
  label: string;
  value: string;
}

function Sandbox() {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState<'menu' | 'input'>('menu');
  const [inputText, setInputText] = useState('');
  const [savedText, setSavedText] = useState('No text saved yet.');
  const [tasks, setTasks] = useState([
    { id: 1, text: 'Design database schema', done: true },
    { id: 2, text: 'Write Markdown parser', done: false },
    { id: 3, text: 'Implement Ink interface', done: false },
  ]);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);

  // Global key listener (e.g. 'q' to quit)
  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }

    // Toggle checklist navigation when in menu tab
    if (activeTab === 'menu') {
      if (key.upArrow) {
        setSelectedTaskIndex((prev) => (prev > 0 ? prev - 1 : tasks.length - 1));
      }
      if (key.downArrow) {
        setSelectedTaskIndex((prev) => (prev < tasks.length - 1 ? prev + 1 : 0));
      }
      if (input === ' ') {
        // Toggle current task
        setTasks((prev) =>
          prev.map((t, idx) => (idx === selectedTaskIndex ? { ...t, done: !t.done } : t))
        );
      }
    }
  });

  const handleMenuSelect = (item: MenuItem) => {
    if (item.value === 'text-input') {
      setActiveTab('input');
    } else if (item.value === 'reset-tasks') {
      setTasks((prev) => prev.map((t) => ({ ...t, done: false })));
    } else if (item.value === 'quit') {
      exit();
    }
  };

  const handleTextInputSubmit = (value: string) => {
    setSavedText(value || 'Empty string submitted.');
    setInputText('');
    setActiveTab('menu');
  };

  // Render ANSI Markdown
  const renderedMarkdown = marked.parse(SAMPLE_MARKDOWN) as string;

  const menuItems: MenuItem[] = [
    { label: '📝 Input Custom Text', value: 'text-input' },
    { label: '🔄 Reset All Tasks', value: 'reset-tasks' },
    { label: '❌ Quit Sandbox', value: 'quit' },
  ];

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan" width={80}>
      {/* Header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text color="yellow" bold>
          🛠️  BAGELWERK INK TUI SANDBOX  🛠️
        </Text>
      </Box>

      {/* Main Content Layout */}
      <Box flexDirection="row" marginBottom={1}>
        {/* Left Side: Markdown Viewer */}
        <Box flexDirection="column" width="50%" paddingRight={2} borderStyle="single" borderColor="gray">
          <Box marginBottom={1}>
            <Text color="blue" bold underline>
              1. Live Markdown Preview
            </Text>
          </Box>
          <Text>{renderedMarkdown}</Text>
        </Box>

        {/* Right Side: Interactive Checklist & Steering */}
        <Box flexDirection="column" width="50%" paddingLeft={2}>
          {/* Checklist */}
          <Box marginBottom={1}>
            <Text color="blue" bold underline>
              2. Interactive Checklist
            </Text>
          </Box>
          <Text color="gray" italic marginBottom={1}>
            (Use Arrow Keys to navigate, Spacebar to toggle)
          </Text>
          {tasks.map((task, idx) => {
            const isSelected = idx === selectedTaskIndex && activeTab === 'menu';
            const checkbox = task.done ? '[x]' : '[ ]';
            return (
              <Box key={task.id} marginLeft={1}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '> ' : '  '}
                  {checkbox} {task.text}
                </Text>
              </Box>
            );
          })}

          {/* Spacer */}
          <Box height={1} />

          {/* Steering Menu or Text Input */}
          <Box marginBottom={1}>
            <Text color="blue" bold underline>
              3. Interactive Steering
            </Text>
          </Box>

          {activeTab === 'menu' ? (
            <Box flexDirection="column">
              <SelectInput items={menuItems} onSelect={handleMenuSelect} />
            </Box>
          ) : (
            <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingLeft={1}>
              <Text color="yellow">Enter custom text (Press Enter to submit, Esc to cancel):</Text>
              <Box flexDirection="row">
                <Text color="green">{" > "}</Text>
                <TextInput
                  value={inputText}
                  onChange={setInputText}
                  onSubmit={handleTextInputSubmit}
                />
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Status Bar */}
      <Box borderStyle="single" borderColor="green" paddingLeft={1} flexDirection="row" justifyContent="space-between">
        <Text color="green">
          Saved Input: <Text color="white" bold>{savedText}</Text>
        </Text>
        <Text color="gray">Press 'q' to Quit</Text>
      </Box>
    </Box>
  );
}

render(<Sandbox />);

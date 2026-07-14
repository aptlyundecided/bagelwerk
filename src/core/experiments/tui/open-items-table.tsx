import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import * as openItemsLib from '../../../../.pi/skills/open-items/cli/openItemsLib.js';
import type { ParsedOpenItem } from '../../../../.pi/skills/open-items/cli/openItemsLib.js';

const lib: any = (openItemsLib as any).default || openItemsLib;
const { loadAllItems } = lib;

// Resolve project directories relative to this ESM module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../');
const itemsDir = path.join(repoRoot, '.agents', 'open-items', 'items');

function getStateColor(state: string): string {
  switch (state) {
    case 'new':
      return 'gray';
    case 'triaged':
      return 'blue';
    case 'ready':
      return 'green';
    case 'in_progress':
      return 'yellow';
    case 'blocked':
      return 'red';
    default:
      return 'white';
  }
}

// Custom hook to track active terminal dimensions
function useTerminalSize() {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 90,
    rows: process.stdout.rows || 20,
  });

  useEffect(() => {
    const handleResize = () => {
      setSize({
        columns: process.stdout.columns || 90,
        rows: process.stdout.rows || 20,
      });
    };

    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  return size;
}

function OpenItemsDashboard() {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ParsedOpenItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Load items from filesystem on mount
  useEffect(() => {
    loadAllItems({ itemsDir, repoRoot })
      .then(({ items }) => {
        // Exclude closed items and sort by ID ascending
        const openItems = items
          .filter((item) => item.isOpen)
          .sort((a, b) => a.id.localeCompare(b.id));
        setItems(openItems);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load open items:', err);
        exit();
      });
  }, []);

  // Keyboard navigation
  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }

    if (items.length === 0) return;

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    }
  });

  if (loading) {
    return (
      <Box padding={1}>
        <Text color="yellow">Loading open items backlog...</Text>
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box padding={1} borderStyle="round" borderColor="red">
        <Text color="red" bold>No open items found in the backlog!</Text>
      </Box>
    );
  }

  const selectedItem = items[selectedIndex];

  // Calculate dynamic heights
  // We subtract 6 rows from total terminal height to account for title, margins, and status bar
  const displayBoxHeight = Math.max(8, rows - 6);
  const maxVisible = Math.max(3, displayBoxHeight - 4); // subtracting border lines and table header row

  // Paging calculations based on dynamic maxVisible size
  let startIdx = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
  let endIdx = Math.min(items.length, startIdx + maxVisible);
  if (endIdx - startIdx < maxVisible) {
    startIdx = Math.max(0, endIdx - maxVisible);
  }
  const visibleItems = items.slice(startIdx, endIdx);

  // Calculate dynamic widths (splitting columns in half, subtracting border padding margins)
  const outerWidth = Math.max(60, columns - 2);

  return (
    <Box flexDirection="column" padding={1} width={outerWidth} height={rows}>
      {/* Title */}
      <Box justifyContent="center" marginBottom={1}>
        <Text color="magenta" bold>
          📋  BAGELWERK BACKLOG BOARD  📋
        </Text>
      </Box>

      {/* Info Header */}
      <Box marginBottom={1} justifyContent="space-between" width="100%" paddingLeft={1}>
        <Text color="cyan">
          Open Items: <Text bold>{items.length}</Text>
        </Text>
        <Text color="gray">
          (Arrows to scroll, 'q' to Exit | Resized to {columns}x{rows})
        </Text>
      </Box>

      {/* Split Pane Layout */}
      <Box flexDirection="row" height={displayBoxHeight} width="100%" flexGrow={1}>
        {/* Left Pane: Backlog List */}
        <Box
          flexDirection="column"
          width="50%"
          height="100%"
          borderStyle="round"
          borderColor="magenta"
          paddingLeft={1}
          paddingRight={1}
        >
          {/* Table Header */}
          <Box borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false} paddingBottom={0} marginBottom={1}>
            <Box width={10}><Text bold color="white">ID</Text></Box>
            <Box width={12}><Text bold color="white">State</Text></Box>
            <Box flexGrow={1}><Text bold color="white">Title</Text></Box>
          </Box>

          {/* List Rows */}
          {visibleItems.map((item) => {
            const actualIndex = items.indexOf(item);
            const isSelected = actualIndex === selectedIndex;
            const stateColor = getStateColor(item.state);
            
            // Calculate a safe width for title truncation based on left pane size
            const maxTitleChars = Math.max(10, Math.floor(columns / 4) - 8);
            const shortTitle = item.title.length > maxTitleChars 
              ? `${item.title.slice(0, maxTitleChars - 3)}...` 
              : item.title;

            return (
              <Box key={item.id} height={1}>
                <Box width={10}>
                  <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                    {isSelected ? '> ' : '  '}
                    {item.id}
                  </Text>
                </Box>
                <Box width={12}>
                  <Text color={stateColor} bold={isSelected}>
                    [{item.state.slice(0, 10)}]
                  </Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color={isSelected ? 'cyan' : undefined} bold={isSelected} wrap="truncate-end">
                    {shortTitle}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>

        {/* Right Pane: Details Inspector */}
        <Box
          flexDirection="column"
          width="50%"
          height="100%"
          borderStyle="round"
          borderColor="cyan"
          paddingLeft={1}
          paddingRight={1}
        >
          {selectedItem ? (
            <Box flexDirection="column" height="100%">
              {/* Header */}
              <Box justifyContent="space-between" borderStyle="single" borderBottom={true} borderTop={false} borderLeft={false} borderRight={false} paddingBottom={0} marginBottom={1}>
                <Text color="yellow" bold>
                  🔍 {selectedItem.id}
                </Text>
                <Text color={getStateColor(selectedItem.state)} bold uppercase>
                  {selectedItem.state}
                </Text>
              </Box>

              {/* Title */}
              <Box marginBottom={1} minHeight={2}>
                <Text bold color="white" wrap="wrap">
                  {selectedItem.title}
                </Text>
              </Box>

              {/* Summary Description Box */}
              <Box flexGrow={1} overflowY="hidden">
                <Text color="gray" italic wrap="wrap">
                  {selectedItem.summary || 'No summary text defined.'}
                </Text>
              </Box>

              {/* Relative File Location */}
              <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} paddingTop={0} marginTop={1}>
                <Text color="gray" wrap="truncate-end">
                  File: {selectedItem.relativePath}
                </Text>
              </Box>
            </Box>
          ) : (
            <Box justifyContent="center" alignItems="center" height="100%">
              <Text color="gray">No item selected</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer bar */}
      <Box marginTop={1} justifyContent="center" width="100%">
        <Text color="gray">Page {Math.floor(selectedIndex / maxVisible) + 1} of {Math.ceil(items.length / maxVisible)}</Text>
      </Box>
    </Box>
  );
}

render(<OpenItemsDashboard />);

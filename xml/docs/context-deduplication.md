# Semantic Context Deduplication

## Overview

The terminal bench agent now includes intelligent context deduplication to prevent agents from repeatedly processing the same or similar information. This system uses semantic similarity to detect when content has already been seen, reducing redundancy and improving efficiency.

## Features

### 1. Semantic Similarity Detection

- **Text Embedding**: Generates feature vectors for content comparison
- **Cosine Similarity**: Measures semantic similarity between contexts
- **Configurable Thresholds**: Adjustable similarity detection (default: 85%)
- **Fast Exact Matching**: MD5 hash-based duplicate detection

### 2. Automatic Deduplication

- **Turn-by-Turn Monitoring**: Analyzes environment responses for duplicates
- **Memory Management**: Maintains bounded context store (max 500 entries)
- **Temporal Tracking**: Records timestamps for context aging
- **Source Attribution**: Tracks where context originated

### 3. Context Analysis Action

Agents can analyze their context patterns using the `context_analysis` action:

```xml
<context_analysis>
action: summary
</context_analysis>
```

## Usage

### Context Analysis Actions

#### Summary
```xml
<context_analysis>
action: summary
</context_analysis>
```

Output:
```
=== Context Summary ===
Total Context Entries: 234
Average Similarity: 23.4%
Oldest Entry: 2025-09-19T14:30:00.000Z
Newest Entry: 2025-09-19T15:45:00.000Z
```

#### Find Duplicates
```xml
<context_analysis>
action: duplicates
threshold: 0.8
</context_analysis>
```

Output:
```
=== Duplicate Clusters (similarity >= 80%) ===

Cluster 1 (3 items):
- turn_5_env_response (2025-09-19T14:30:00.000Z)
  File content from src/config.ts showing database configuration...
- turn_12_env_response (2025-09-19T14:35:00.000Z)  
  File content from src/config.ts showing database configuration...
- turn_18_env_response (2025-09-19T14:40:00.000Z)
  File content from src/config.ts showing database configuration...
```

#### Purge Old Context
```xml
<context_analysis>
action: purge
maxAge: 86400000
</context_analysis>
```

Output:
```
Purged 45 context entries older than 24 hours
```

#### Check Similarity
```xml
<context_analysis>
action: check
content: "The database configuration includes host, port, and credentials"
</context_analysis>
```

Output:
```
Similarity check result:
Is Duplicate: true
Similarity Score: 89.2%
Similar content found (89.2% similarity) from turn_5_env_response

Similar entry from: turn_5_env_response
Timestamp: 2025-09-19T14:30:00.000Z
Content preview: The database configuration includes host localhost, port 5432, username admin, password secret, and database name myapp_dev...
```

## Implementation Details

### Similarity Algorithm

The system uses a hybrid approach for similarity detection:

1. **Exact Matching**: MD5 hash comparison for identical content
2. **Semantic Embedding**: Simple text-based feature extraction including:
   - Character n-grams (trigrams)
   - Word frequency vectors
   - Length normalization
   - Cosine similarity comparison

### Memory Management

- **Bounded Storage**: Maximum 500 context entries in memory
- **LRU Eviction**: Oldest entries removed when limit exceeded
- **Temporal Purging**: Automatic cleanup of aged context

### Performance Characteristics

- **Fast Exact Matching**: O(1) hash-based duplicate detection
- **Similarity Computation**: O(n) for new context vs existing entries
- **Memory Usage**: ~1KB per context entry on average
- **Processing Overhead**: <5ms per similarity check

## Benefits

### 1. Reduced Redundancy
- Prevents re-reading the same files repeatedly
- Avoids duplicate analysis of identical content
- Minimizes context window pollution

### 2. Improved Efficiency
- Faster task completion with less redundant work
- Better focus on new and relevant information
- Reduced token usage in LLM interactions

### 3. Enhanced Awareness
- Agents can detect when they're repeating actions
- Self-monitoring of information gathering patterns
- Optimization opportunities identification

## Configuration

### Similarity Threshold
```typescript
// Default: 85% similarity threshold
new ContextDeduplicator({
  similarityThreshold: 0.85
});
```

### Memory Limits
```typescript
// Default: 500 entries maximum
new ContextDeduplicator({
  maxContextEntries: 500
});
```

### Enable/Disable
```typescript
// Disable deduplication if needed
new ConversationHistoryManager(false);
```

## Use Cases

### 1. Preventing File Re-reading
Agent notices it has already read a configuration file:

```xml
<context_analysis>
action: check
content: "Database configuration from config/database.yml"
</context_analysis>

<!-- Result shows 95% similarity, agent skips re-reading -->
```

### 2. Detecting Repetitive Analysis
Agent identifies repeated log analysis:

```xml
<context_analysis>
action: duplicates
threshold: 0.9
</context_analysis>

<!-- Shows multiple similar log file readings -->
```

### 3. Context Cleanup
Agent cleans up old context before intensive operation:

```xml
<context_analysis>
action: purge
maxAge: 3600000
</context_analysis>

<!-- Removes context older than 1 hour -->
```

## Best Practices

### For Agents

1. **Check Before Reading**: Use similarity check for large files
2. **Regular Cleanup**: Purge old context periodically
3. **Monitor Patterns**: Review duplicates to optimize behavior
4. **Adaptive Thresholds**: Adjust similarity based on content type

### For System Integration

1. **Balanced Thresholds**: Too high misses duplicates, too low false positives
2. **Context Relevance**: Consider temporal relevance in similarity scoring
3. **Performance Monitoring**: Track deduplication effectiveness
4. **Memory Management**: Regular purging of aged context

## Example Adaptive Behavior

```xml
<!-- Agent checks if it has seen similar content before -->
<context_analysis>
action: check
content: "Package.json dependencies and scripts"
</context_analysis>

<!-- High similarity detected, agent skips detailed re-analysis -->
<add_note>
content: "Skipping package.json re-analysis - 94% similar to previous reading"
</add_note>

<!-- Agent focuses on new/changed aspects instead -->
<grep>
pattern: "\"version\""
path: "package.json"
</grep>
```

## Troubleshooting

### High False Positives
- Lower similarity threshold
- Check for overly generic content
- Review embedding algorithm effectiveness

### Missing Duplicates
- Increase similarity threshold
- Verify content normalization
- Check for timestamp/formatting differences

### Memory Issues
- Reduce max context entries
- Implement more aggressive purging
- Monitor context growth patterns

## Future Enhancements

1. **Advanced Embeddings**: Integration with transformer-based embeddings
2. **Contextual Similarity**: Consider task relevance in similarity scoring
3. **Learning System**: Adapt thresholds based on effectiveness
4. **Cross-Session Persistence**: Maintain context across agent restarts
5. **Hierarchical Clustering**: Better organization of similar contexts

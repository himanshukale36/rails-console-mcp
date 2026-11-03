export const JSON_BEGIN = '__RAILS_MCP_JSON_BEGIN__';
export const JSON_END = '__RAILS_MCP_JSON_END__';

export function extractJson(output) {
  const start = output.indexOf(JSON_BEGIN);
  if (start < 0) return output;
  // Search for JSON_END after the BEGIN offset to avoid slicing on a stray
  // earlier END left in the buffer by a previous/partial eval.
  const end = output.indexOf(JSON_END, start + JSON_BEGIN.length);
  if (end < 0) return output;
  return output.slice(start + JSON_BEGIN.length, end).trim();
}

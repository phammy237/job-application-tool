export function AnalyzeButton({
  disabled,
  analyzing,
  onClick,
}: {
  disabled: boolean;
  analyzing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 6,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: '#1e293b',
        color: 'white',
      }}
    >
      {analyzing ? 'Analyzing…' : 'Analyze Job'}
    </button>
  );
}

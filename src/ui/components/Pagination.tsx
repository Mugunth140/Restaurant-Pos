import React from "react";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
};

const Pagination: React.FC<Props> = ({ page, pageSize, total, onChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
      <button className="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Prev
      </button>
      <span className="muted" style={{ padding: "0 8px" }}>
        {page} / {totalPages}
      </span>
      <button
        className="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
};

export default Pagination;

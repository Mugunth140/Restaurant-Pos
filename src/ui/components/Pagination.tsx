import React from "react";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
};

const Pagination: React.FC<Props> = ({ page, pageSize, total, onChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="button button-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Prev
      </button>
      <span className="page-info">
        {page} / {totalPages}
      </span>
      <button className="button button-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
};

export default Pagination;

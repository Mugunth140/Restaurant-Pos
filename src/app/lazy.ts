import React from "react";

const BillingPage = React.lazy(() => import("../ui/pages/BillingPage"));
const CategoriesPage = React.lazy(() => import("../ui/pages/CategoriesPage"));
const BillHistoryPage = React.lazy(() => import("../ui/pages/BillHistoryPage"));
const AnalyticsPage = React.lazy(() => import("../ui/pages/AnalyticsPage"));
const BackupPage = React.lazy(() => import("../ui/pages/BackupPage"));

export const pages = {
  billing: BillingPage,
  categories: CategoriesPage,
  history: BillHistoryPage,
  analytics: AnalyticsPage,
  backup: BackupPage
};

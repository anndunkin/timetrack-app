import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "./components/ThemeProvider";
import Layout from "./components/Layout";
import TimeEntryPage from "./pages/TimeEntryPage";
import HistoryPage from "./pages/HistoryPage";
import WeeklyPage from "./pages/WeeklyPage";
import MonthlyPage from "./pages/MonthlyPage";
import AnnualPage from "./pages/AnnualPage";
import AdminPage from "./pages/AdminPage";
import SettingsPage from "./pages/SettingsPage";
import DatabasePage from "./pages/DatabasePage";
import NotFound from "./pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router hook={useHashLocation}>
          <Layout>
            <Switch>
              <Route path="/" component={TimeEntryPage} />
              <Route path="/history" component={HistoryPage} />
              <Route path="/weekly" component={WeeklyPage} />
              <Route path="/monthly" component={MonthlyPage} />
              <Route path="/annual" component={AnnualPage} />
              <Route path="/admin" component={AdminPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/database" component={DatabasePage} />
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

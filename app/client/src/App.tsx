import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "./components/ThemeProvider";
import Layout from "./components/Layout";
import TimeEntryPage from "./pages/TimeEntryPage";
import WeeklyPage from "./pages/WeeklyPage";
import AnnualPage from "./pages/AnnualPage";
import AdminPage from "./pages/AdminPage";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router hook={useHashLocation}>
          <Layout>
            <Switch>
              <Route path="/" component={TimeEntryPage} />
              <Route path="/weekly" component={WeeklyPage} />
              <Route path="/annual" component={AnnualPage} />
              <Route path="/admin" component={AdminPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

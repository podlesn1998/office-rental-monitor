import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import TelegramPage from "./pages/TelegramPage";
import LogsPage from "./pages/LogsPage";
import AddListingPage from "./pages/AddListingPage";
import BottomNav from "./components/BottomNav";

function Router() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/settings"} component={Settings} />
        <Route path={"/telegram"} component={TelegramPage} />
        <Route path={"/logs"} component={LogsPage} />
        <Route path={"/add"} component={AddListingPage} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
      <BottomNav />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster position="top-center" theme="dark" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

import { useCallback, useEffect, useState } from 'react';
import { CustomerOrderingApp } from './components/CustomerOrderingApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OwnerDashboard } from './components/OwnerDashboard';
import { RikZenIntro } from './components/RikZenIntro';
import { ShopEntrance } from './components/ShopEntrance';

interface RouteState {
  pathname: string;
  tableNumber: number | null;
}

function parseLocation(): RouteState {
  if (typeof window === 'undefined') {
    return { pathname: '/', tableNumber: null };
  }
  const pathname = window.location.pathname || '/';
  const params = new URLSearchParams(window.location.search);
  const rawTable = params.get('table');
  const parsedTable = rawTable ? Number(rawTable) : NaN;
  const tableNumber =
    Number.isInteger(parsedTable) && parsedTable >= 1 && parsedTable <= 6 ? parsedTable : null;
  return { pathname, tableNumber };
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseLocation());
  const [showIntro, setShowIntro] = useState(true);

  const handleIntroComplete = useCallback(() => {
    setShowIntro(false);
  }, []);

  const navigate = useCallback((targetPath: string) => {
    window.history.pushState({}, '', targetPath);
    setRoute(parseLocation());
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(parseLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const isOwnerRoute = route.pathname === '/owner' || route.pathname === '/admin';
  const isMenuRoute = route.pathname === '/menu' || route.tableNumber !== null;

  return (
    <ErrorBoundary>
      {showIntro && !isOwnerRoute && (
        <RikZenIntro
          mode={isMenuRoute && route.tableNumber ? 'quick' : 'full'}
          onComplete={handleIntroComplete}
        />
      )}
      {isOwnerRoute ? (
        <OwnerDashboard onNavigate={navigate} />
      ) : isMenuRoute && route.tableNumber ? (
        <CustomerOrderingApp tableNumber={route.tableNumber} onNavigate={navigate} />
      ) : (
        <ShopEntrance onNavigate={navigate} />
      )}
    </ErrorBoundary>
  );
}

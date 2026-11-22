import { useCallback, useEffect, useState } from 'react';
import { CustomerOrderingApp } from './components/CustomerOrderingApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OwnerDashboard } from './components/OwnerDashboard';
import { PublicBillPage } from './components/PublicBillPage';
import { RikZenIntro } from './components/RikZenIntro';
import { ShopEntrance } from './components/ShopEntrance';

const LAST_SCANNED_TABLE_KEY = 'rikzen_last_table_number';

interface RouteState {
  pathname: string;
  tableNumber: number | null;
  billId: string | null;
}

function parseLocation(): RouteState {
  if (typeof window === 'undefined') {
    return { pathname: '/', tableNumber: null, billId: null };
  }
  const pathname = window.location.pathname || '/';
  const billMatch = pathname.match(/^\/bill\/([A-Za-z0-9_-]{6,64})\/?$/);
  const billId = billMatch ? billMatch[1] : null;

  const params = new URLSearchParams(window.location.search);
  const rawTable = params.get('table');
  const parsedTable = rawTable ? Number(rawTable) : NaN;
  let tableNumber =
    Number.isInteger(parsedTable) && parsedTable >= 1 && parsedTable <= 6 ? parsedTable : null;

  if (tableNumber) {
    try {
      sessionStorage.setItem(LAST_SCANNED_TABLE_KEY, String(tableNumber));
    } catch {
      // Ignore storage errors
    }
  } else if (pathname === '/menu' && !rawTable) {
    // Allow Main Website QR (/menu) to show the clean Table Picker explicitly
    tableNumber = null;
  }

  return { pathname, tableNumber, billId };
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseLocation());
  const [showIntro, setShowIntro] = useState(() => !parseLocation().billId);

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
  const isBillRoute = Boolean(route.billId);
  const isMenuRoute = route.pathname === '/menu' || route.tableNumber !== null;

  return (
    <ErrorBoundary>
      {showIntro && !isOwnerRoute && !isBillRoute && (
        <RikZenIntro
          mode={isMenuRoute && route.tableNumber ? 'quick' : 'full'}
          onComplete={handleIntroComplete}
        />
      )}
      {isOwnerRoute ? (
        <OwnerDashboard onNavigate={navigate} />
      ) : isBillRoute && route.billId ? (
        <PublicBillPage billId={route.billId} onNavigate={navigate} />
      ) : isMenuRoute && route.tableNumber ? (
        <CustomerOrderingApp tableNumber={route.tableNumber} onNavigate={navigate} />
      ) : (
        <ShopEntrance onNavigate={navigate} />
      )}
    </ErrorBoundary>
  );
}

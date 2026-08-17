// src/__tests__/components/Header.test.jsx — Header component tests
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Header from '../../components/Header';

// Mock context providers
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, email: 'test@example.com', role: 'user' },
    logout: vi.fn(),
    isAuthenticated: true,
  }),
}));

vi.mock('../../context/PortfolioContext', () => ({
  usePortfolio: () => ({
    credits: [],
    portfolioValue: 0,
    refetchPortfolio: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

const renderWithRouter = (component) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe('Header', () => {
  test('renders logo', () => {
    renderWithRouter(<Header />);
    expect(screen.getByAltText('EtherTrack Logo')).toBeInTheDocument();
  });

  test('renders navigation links', () => {
    renderWithRouter(<Header />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Portfolio')).toBeInTheDocument();
  });

  test('shows user menu when authenticated', () => {
    renderWithRouter(<Header />);
    const userButton = screen.getByLabelText('User menu');
    expect(userButton).toBeInTheDocument();
  });
});
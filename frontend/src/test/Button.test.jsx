import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Button from '../components/Button';

describe('Button', () => {
  test('renders button text', () => {
    render(
      <MemoryRouter>
        <Button>Plan a trip</Button>
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: 'Plan a trip' })).toBeInTheDocument();
  });
});

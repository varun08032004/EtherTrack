import { Link, useLocation, useNavigate } from "react-router-dom";
import "../styles/Breadcrumbs.css";


const Breadcrumbs = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Generate breadcrumb paths from current URL
  const pathnames = location.pathname.split("/").filter((x) => x);

  return (
    <div className="breadcrumb-container">
      <button onClick={() => navigate(-1)} className="back-btn">⬅ Back</button>
      <nav className="breadcrumbs">
        <Link to="/">Home</Link>
        {pathnames.map((value, index) => {
          const to = `/${pathnames.slice(0, index + 1).join("/")}`;
          return (
            <span key={to}>
              {" > "}
              <Link to={to}>{value.replace(/-/g, " ")}</Link>
            </span>
          );
        })}
      </nav>
    </div>
  );
};

export default Breadcrumbs;

import React from "react";
import "../App.css";

function Contact() {
  return (
    <main className="contact-page">
      <header className="page-header">
        <h1>Contact Us</h1>
      </header>

      <section className="contact-content">
        <div className="contact-intro">
          <h2>Annasaheb Dange College of Engineering and Technology</h2>
          <p>
            Sant Dnyaneshwar Shikshan Sanstha's Annasaheb Dange College of
            Engineering and Technology (ADCET), Ashta.
          </p>
        </div>

        <div className="contact-details">
          <div className="contact-card">
            <div className="contact-icon">📍</div>
            <h3>Address</h3>
            <p>
              Annasaheb Dange College of Engineering and Technology (ADCET),
              <br />
              Ashta, Dist. Sangli,
              <br />
              Maharashtra - 102 102
            </p>
          </div>

          <div className="contact-card">
            <div className="contact-icon">📞</div>
            <h3>Phone</h3>
            <p>
              <a href="tel:+918600600700">+91-8600600700</a>
            </p>
          </div>

          <div className="contact-card">
            <div className="contact-icon">✉️</div>
            <h3>Email</h3>
            <p>
              <a href="mailto:director@adcet.in">director@adcet.in</a>
            </p>
          </div>

          <div className="contact-card">
            <div className="contact-icon">🌐</div>
            <h3>Website</h3>
            <p>
              <a
                href="#"
                target="_blank"
                rel="noopener noreferrer"
              >
                www.adcet.ac.in
              </a>
            </p>
          </div>
        </div>

        <section className="contact-message">
          <h2>Get In Touch</h2>
          <p>
            For any inquiries, admission-related information, or other
            assistance, please contact Annasaheb Dange College of Engineering
            and Technology, Ashta using the details provided above.
          </p>
        </section>
      </section>
    </main>
  );
}

export default Contact;

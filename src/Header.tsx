import React, {useState} from "react";
import {type AppUser, useAuth} from "./hooks/useAuth";
import ProfileModal from "./ProfileModal.tsx";

type HeaderPageProps = {
    user: AppUser;
};

function Header({user}: HeaderPageProps) {

    const {logout} = useAuth();
    const [showProfile, setShowProfile] = useState(false);

    return (
        <header>
            <div className={`header-container ${user.role === "admin" ? "admin" : ""}`}>
                <div className="left-header">
                    <img src="/favicon.svg" alt="Logo" className=""/>
                    {user.role === "admin" && (
                        <nav className="header-nav">
                            <button
                                id="admin-users-button"
                                className="button button-colorless button-small boldFont"
                                onClick={() => {
                                    document.getElementById('admin-attendence-button')?.classList.remove('boldFont');
                                    document.getElementById('admin-users-button')?.classList.add('boldFont');
                                    document.getElementById('admin-stats-button')?.classList.remove('boldFont');
                                    document.getElementById('users')?.classList.remove('visually-hidden');
                                    document.getElementById('attendance-books')?.classList.add('visually-hidden');
                                    document.getElementById('statistics')?.classList.add('visually-hidden');
                                }}>Brukere</button>
                            <button
                                id="admin-attendence-button"
                                className="button button-colorless button-small"
                                onClick={() => {
                                    document.getElementById('admin-attendence-button')?.classList.add('boldFont');
                                    document.getElementById('admin-users-button')?.classList.remove('boldFont');
                                    document.getElementById('admin-stats-button')?.classList.remove('boldFont');
                                    document.getElementById('users')?.classList.add('visually-hidden');
                                    document.getElementById('attendance-books')?.classList.remove('visually-hidden');
                                    document.getElementById('statistics')?.classList.add('visually-hidden');
                                }}>Oppmøtebøker</button>
                            <button
                                id="admin-stats-button"
                                className="button button-colorless button-small"
                                onClick={() => {
                                    document.getElementById('admin-attendence-button')?.classList.remove('boldFont');
                                    document.getElementById('admin-users-button')?.classList.remove('boldFont');
                                    document.getElementById('admin-stats-button')?.classList.add('boldFont');
                                    document.getElementById('users')?.classList.add('visually-hidden');
                                    document.getElementById('attendance-books')?.classList.add('visually-hidden');
                                    document.getElementById('statistics')?.classList.remove('visually-hidden');
                                }}>Statistikk</button>
                        </nav>
                    )}
                </div>
                <div className="header-buttons">
                    <button
                        className="button full-border button-colorless boldFont round-corners-whole25"
                        type="button"
                        onClick={() => setShowProfile(true)}
                    >Min profil
                    </button>
                    <button
                        className="button full-border button-black boldFont round-corners-whole25"
                        type="button"
                        onClick={logout}
                    >Logg ut
                    </button>
                </div>
            </div>
            <div>
                {showProfile && (
                    <ProfileModal
                        uid={user.uid}
                        role={user.role}
                        email={user.email}
                        displayName={user.displayName}
                        onClose={() => setShowProfile(false)}
                    />
                )}
            </div>
        </header>
    );
}

export default Header;